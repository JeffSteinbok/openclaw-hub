/**
 * Indexer — SQLite FTS5 index for Obsidian vault notes.
 *
 * Provides full-text search, tag indexing, and link graph storage.
 * Uses better-sqlite3 for synchronous SQLite access.
 * File watching via chokidar for incremental updates.
 */

import { readFileSync, statSync, mkdirSync } from "node:fs";
import { join, relative, dirname, extname, basename } from "node:path";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { watch } from "chokidar";
import type { FSWatcher } from "chokidar";
import { parseNote } from "./parser.js";
import { resolveSafePath } from "./security.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IndexConfig {
  vaultRoot: string;
  indexLocation: string;
}

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  rank: number;
}

export interface NoteRecord {
  path: string;
  title: string;
  content: string;
  frontmatter_json: string;
  mtime_ms: number;
}

export interface RecentNote {
  path: string;
  title: string;
  mtime_ms: number;
}

// ---------------------------------------------------------------------------
// Index class
// ---------------------------------------------------------------------------

export class VaultIndex {
  private db: BetterSqlite3.Database;
  private vaultRoot: string;
  private watcher: FSWatcher | null = null;
  private _ready = false;
  private _indexingPromise: Promise<void> | null = null;

  constructor(config: IndexConfig) {
    this.vaultRoot = config.vaultRoot;

    // Ensure index directory exists
    mkdirSync(dirname(config.indexLocation), { recursive: true });

    this.db = new Database(config.indexLocation);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initSchema();
  }

  get ready(): boolean {
    return this._ready;
  }

  // -------------------------------------------------------------------------
  // Schema
  // -------------------------------------------------------------------------

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        path TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        frontmatter_json TEXT NOT NULL DEFAULT '{}',
        mtime_ms INTEGER NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        title,
        content,
        content='notes',
        content_rowid='rowid'
      );

      -- Triggers to keep FTS in sync
      CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
        INSERT INTO notes_fts(rowid, title, content)
        VALUES (new.rowid, new.title, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, content)
        VALUES ('delete', old.rowid, old.title, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, content)
        VALUES ('delete', old.rowid, old.title, old.content);
        INSERT INTO notes_fts(rowid, title, content)
        VALUES (new.rowid, new.title, new.content);
      END;

      CREATE TABLE IF NOT EXISTS tags (
        note_path TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (note_path, tag),
        FOREIGN KEY (note_path) REFERENCES notes(path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);

      CREATE TABLE IF NOT EXISTS links (
        source_path TEXT NOT NULL,
        target TEXT NOT NULL,
        alias TEXT,
        FOREIGN KEY (source_path) REFERENCES notes(path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_path);
      CREATE INDEX IF NOT EXISTS idx_links_target ON links(target);
    `);
  }

  // -------------------------------------------------------------------------
  // Indexing
  // -------------------------------------------------------------------------

  /**
   * Start the initial full vault scan and file watcher.
   * Returns a promise that resolves when initial indexing is complete.
   */
  async startIndexing(): Promise<void> {
    if (this._indexingPromise) return this._indexingPromise;

    this._indexingPromise = this.performFullScan().then(() => {
      this._ready = true;
      this.startWatcher();
    });

    return this._indexingPromise;
  }

  private async performFullScan(): Promise<void> {
    const { readdirSync } = await import("node:fs");
    const files = this.collectMarkdownFiles(this.vaultRoot, readdirSync);

    // Batch insert for performance
    const insertNote = this.db.prepare(`
      INSERT OR REPLACE INTO notes (path, title, content, frontmatter_json, mtime_ms)
      VALUES (@path, @title, @content, @frontmatter_json, @mtime_ms)
    `);
    const insertTag = this.db.prepare(
      `INSERT OR REPLACE INTO tags (note_path, tag) VALUES (@note_path, @tag)`
    );
    const insertLink = this.db.prepare(
      `INSERT INTO links (source_path, target, alias) VALUES (@source_path, @target, @alias)`
    );
    const deleteLinks = this.db.prepare(`DELETE FROM links WHERE source_path = ?`);
    const deleteTags = this.db.prepare(`DELETE FROM tags WHERE note_path = ?`);

    const batchSize = 100;
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      const txn = this.db.transaction(() => {
        for (const filePath of batch) {
          this.indexSingleFile(filePath, insertNote, insertTag, insertLink, deleteLinks, deleteTags);
        }
      });
      txn();

      // Yield to event loop between batches
      if (i + batchSize < files.length) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }

  private collectMarkdownFiles(
    dir: string,
    readdirSync: (p: string, opts: { withFileTypes: true }) => import("node:fs").Dirent[],
  ): string[] {
    const files: string[] = [];
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        // Skip hidden files/dirs (starting with .)
        if (entry.name.startsWith(".")) continue;

        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          files.push(...this.collectMarkdownFiles(fullPath, readdirSync));
        } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
          files.push(fullPath);
        }
        // Skip symlinks entirely
      }
    } catch {
      // Skip directories we can't read
    }
    return files;
  }

  private indexSingleFile(
    absolutePath: string,
    insertNote: BetterSqlite3.Statement,
    insertTag: BetterSqlite3.Statement,
    insertLink: BetterSqlite3.Statement,
    deleteLinks: BetterSqlite3.Statement,
    deleteTags: BetterSqlite3.Statement,
  ): void {
    try {
      const relPath = relative(this.vaultRoot, absolutePath);
      const raw = readFileSync(absolutePath, "utf-8");
      const stat = statSync(absolutePath);
      const parsed = parseNote(raw, relPath);

      insertNote.run({
        path: relPath,
        title: parsed.title,
        content: parsed.content,
        frontmatter_json: JSON.stringify(parsed.frontmatter),
        mtime_ms: stat.mtimeMs,
      });

      // Clear old tags/links and re-insert
      deleteTags.run(relPath);
      deleteLinks.run(relPath);

      for (const tag of parsed.tags) {
        insertTag.run({ note_path: relPath, tag });
      }

      for (const link of parsed.wikilinks) {
        insertLink.run({
          source_path: relPath,
          target: link.target,
          alias: link.alias,
        });
      }
    } catch {
      // Skip files that can't be read or parsed
    }
  }

  // -------------------------------------------------------------------------
  // File watcher
  // -------------------------------------------------------------------------

  private startWatcher(): void {
    this.watcher = watch(this.vaultRoot, {
      ignored: /(^|[/\\])\./,  // Ignore dotfiles
      persistent: true,
      followSymlinks: false,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    const stmts = this.prepareStatements();

    this.watcher
      .on("add", (path) => this.onFileChange(path, stmts))
      .on("change", (path) => this.onFileChange(path, stmts))
      .on("unlink", (path) => this.onFileRemove(path));
  }

  private prepareStatements() {
    return {
      insertNote: this.db.prepare(`
        INSERT OR REPLACE INTO notes (path, title, content, frontmatter_json, mtime_ms)
        VALUES (@path, @title, @content, @frontmatter_json, @mtime_ms)
      `),
      insertTag: this.db.prepare(
        `INSERT OR REPLACE INTO tags (note_path, tag) VALUES (@note_path, @tag)`
      ),
      insertLink: this.db.prepare(
        `INSERT INTO links (source_path, target, alias) VALUES (@source_path, @target, @alias)`
      ),
      deleteLinks: this.db.prepare(`DELETE FROM links WHERE source_path = ?`),
      deleteTags: this.db.prepare(`DELETE FROM tags WHERE note_path = ?`),
    };
  }

  private onFileChange(
    absolutePath: string,
    stmts: ReturnType<typeof this.prepareStatements>,
  ): void {
    if (extname(absolutePath).toLowerCase() !== ".md") return;
    try {
      this.indexSingleFile(
        absolutePath,
        stmts.insertNote,
        stmts.insertTag,
        stmts.insertLink,
        stmts.deleteLinks,
        stmts.deleteTags,
      );
    } catch {
      // Ignore indexing errors for individual files
    }
  }

  private onFileRemove(absolutePath: string): void {
    if (extname(absolutePath).toLowerCase() !== ".md") return;
    try {
      const relPath = relative(this.vaultRoot, absolutePath);
      this.db.prepare(`DELETE FROM notes WHERE path = ?`).run(relPath);
    } catch {
      // Ignore
    }
  }

  // -------------------------------------------------------------------------
  // Query methods
  // -------------------------------------------------------------------------

  search(query: string, limit: number = 20): SearchResult[] {
    const stmt = this.db.prepare(`
      SELECT
        n.path,
        n.title,
        snippet(notes_fts, 1, '>>>', '<<<', '...', 40) AS snippet,
        rank
      FROM notes_fts
      JOIN notes n ON n.rowid = notes_fts.rowid
      WHERE notes_fts MATCH @query
      ORDER BY rank
      LIMIT @limit
    `);

    return stmt.all({ query, limit }) as SearchResult[];
  }

  readNote(relPath: string): NoteRecord | null {
    const stmt = this.db.prepare(`SELECT * FROM notes WHERE path = ?`);
    return (stmt.get(relPath) as NoteRecord) ?? null;
  }

  listRecent(limit: number = 20): RecentNote[] {
    const stmt = this.db.prepare(`
      SELECT path, title, mtime_ms
      FROM notes
      ORDER BY mtime_ms DESC
      LIMIT ?
    `);
    return stmt.all(limit) as RecentNote[];
  }

  listTags(): string[] {
    const rows = this.db.prepare(`SELECT DISTINCT tag FROM tags ORDER BY tag`).all() as { tag: string }[];
    return rows.map((r) => r.tag);
  }

  getBacklinks(notePath: string): { path: string; title: string }[] {
    // Resolve the target: match by exact path, by basename, or without .md extension
    const noteBasename = basename(notePath, ".md");

    const stmt = this.db.prepare(`
      SELECT DISTINCT n.path, n.title
      FROM links l
      JOIN notes n ON n.path = l.source_path
      WHERE l.target = @exact
         OR l.target = @basename
         OR l.target = @withExt
      ORDER BY n.title
    `);

    return stmt.all({
      exact: notePath,
      basename: noteBasename,
      withExt: notePath.endsWith(".md") ? notePath : notePath + ".md",
    }) as { path: string; title: string }[];
  }

  getRelatedNotes(notePath: string): { path: string; title: string; reasons: string[] }[] {
    // Find related notes via shared links and shared tags
    const relatedMap = new Map<string, { title: string; reasons: Set<string> }>();

    // 1. Notes linked from this note
    const outgoing = this.db.prepare(`
      SELECT DISTINCT n.path, n.title, l.target
      FROM links l
      JOIN notes n ON (
        n.path = l.target
        OR n.path = l.target || '.md'
        OR n.path LIKE '%/' || l.target || '.md'
      )
      WHERE l.source_path = ?
    `).all(notePath) as { path: string; title: string; target: string }[];

    for (const row of outgoing) {
      if (row.path === notePath) continue;
      const entry = relatedMap.get(row.path) ?? { title: row.title, reasons: new Set() };
      entry.reasons.add("linked-from-this-note");
      relatedMap.set(row.path, entry);
    }

    // 2. Notes that link to this note (backlinks)
    const backlinks = this.getBacklinks(notePath);
    for (const bl of backlinks) {
      if (bl.path === notePath) continue;
      const entry = relatedMap.get(bl.path) ?? { title: bl.title, reasons: new Set() };
      entry.reasons.add("links-to-this-note");
      relatedMap.set(bl.path, entry);
    }

    // 3. Notes sharing tags
    const noteTags = this.db.prepare(
      `SELECT tag FROM tags WHERE note_path = ?`
    ).all(notePath) as { tag: string }[];

    if (noteTags.length > 0) {
      const tagValues = noteTags.map((t) => t.tag);
      const placeholders = tagValues.map(() => "?").join(",");
      const sharedTagNotes = this.db.prepare(`
        SELECT DISTINCT n.path, n.title, t.tag
        FROM tags t
        JOIN notes n ON n.path = t.note_path
        WHERE t.tag IN (${placeholders})
          AND t.note_path != ?
      `).all(...tagValues, notePath) as { path: string; title: string; tag: string }[];

      for (const row of sharedTagNotes) {
        const entry = relatedMap.get(row.path) ?? { title: row.title, reasons: new Set() };
        entry.reasons.add(`shared-tag:${row.tag}`);
        relatedMap.set(row.path, entry);
      }
    }

    return [...relatedMap.entries()]
      .map(([path, { title, reasons }]) => ({ path, title, reasons: [...reasons] }))
      .sort((a, b) => b.reasons.length - a.reasons.length);
  }

  getNoteCount(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM notes`).get() as { count: number };
    return row.count;
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  async close(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.db.close();
  }
}
