/**
 * VaultReader — read-only query interface to the Obsidian vault index.
 *
 * Opens the SQLite FTS5 index database in read-only mode. The index is
 * built and maintained by the obsidian-indexer service. This module only
 * reads — it never creates, modifies, or migrates the schema.
 */

import { existsSync } from "node:fs";
import { basename } from "node:path";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import {
  validateSchemaVersion,
  type SearchResult,
  type NoteRecord,
  type RecentNote,
} from "@openclaw/obsidian-core";

// ---------------------------------------------------------------------------
// Status types
// ---------------------------------------------------------------------------

export type ReaderStatus =
  | { state: "ready" }
  | { state: "index_missing"; message: string }
  | { state: "index_empty"; message: string }
  | { state: "schema_incompatible"; message: string };

// ---------------------------------------------------------------------------
// VaultReader
// ---------------------------------------------------------------------------

export class VaultReader {
  private db: BetterSqlite3.Database | null = null;
  private indexPath: string;

  constructor(indexPath: string) {
    this.indexPath = indexPath;
    this.tryOpen();
  }

  /** Attempt to open the DB. Called on construction and can be retried. */
  private tryOpen(): void {
    if (!existsSync(this.indexPath)) {
      return; // service hasn't created it yet
    }

    try {
      const db = new Database(this.indexPath, { readonly: true, fileMustExist: true });
      db.pragma("query_only = ON");
      db.pragma("busy_timeout = 3000");
      this.db = db;
    } catch {
      // DB may be locked or corrupted — we'll report status
      this.db = null;
    }
  }

  /** Check the current reader status. */
  getStatus(): ReaderStatus {
    if (!this.db) {
      if (!existsSync(this.indexPath)) {
        return {
          state: "index_missing",
          message: "Index database not found. Is the obsidian-indexer service running?",
        };
      }
      // Try to reopen
      this.tryOpen();
      if (!this.db) {
        return {
          state: "index_missing",
          message: "Could not open index database. Check file permissions.",
        };
      }
    }

    if (!validateSchemaVersion(this.db)) {
      return {
        state: "schema_incompatible",
        message: "Index schema version mismatch. Restart the obsidian-indexer service.",
      };
    }

    const count = this.getNoteCount();
    if (count === 0) {
      return {
        state: "index_empty",
        message: "Index is empty. The obsidian-indexer service may still be building.",
      };
    }

    return { state: "ready" };
  }

  get ready(): boolean {
    return this.getStatus().state === "ready";
  }

  // -------------------------------------------------------------------------
  // Query methods
  // -------------------------------------------------------------------------

  search(query: string, limit: number = 20): SearchResult[] {
    if (!this.db) return [];

    const prefixQuery = this.toPrefixQuery(query);

    const ftsStmt = this.db.prepare(`
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

    let results: SearchResult[];
    try {
      results = ftsStmt.all({ query: prefixQuery, limit }) as SearchResult[];
    } catch {
      results = [];
    }

    if (results.length === 0) {
      return this.searchLikeFallback(query, limit);
    }
    return results;
  }

  /** Convert "washing machine" → "washing* machine*" for prefix matching. */
  private toPrefixQuery(query: string): string {
    if (/[*"()]|AND|OR|NOT|NEAR/.test(query)) return query;
    return query
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `${w}*`)
      .join(" ");
  }

  /** Substring fallback using LIKE — slower but catches things FTS5 misses. */
  private searchLikeFallback(query: string, limit: number): SearchResult[] {
    if (!this.db) return [];
    const pattern = `%${query}%`;
    const stmt = this.db.prepare(`
      SELECT
        n.path,
        n.title,
        substr(n.content, max(1, instr(lower(n.content), lower(@pattern2)) - 60), 120) AS snippet,
        0 AS rank
      FROM notes n
      WHERE lower(n.content) LIKE lower(@pattern) OR lower(n.title) LIKE lower(@pattern)
      ORDER BY n.mtime_ms DESC
      LIMIT @limit
    `);
    return stmt.all({ pattern, pattern2: query, limit }) as SearchResult[];
  }

  readNote(relPath: string): NoteRecord | null {
    if (!this.db) return null;
    const stmt = this.db.prepare("SELECT * FROM notes WHERE path = ?");
    return (stmt.get(relPath) as NoteRecord) ?? null;
  }

  listRecent(limit: number = 20): RecentNote[] {
    if (!this.db) return [];
    const stmt = this.db.prepare(`
      SELECT path, title, mtime_ms
      FROM notes
      ORDER BY mtime_ms DESC
      LIMIT ?
    `);
    return stmt.all(limit) as RecentNote[];
  }

  listTags(): string[] {
    if (!this.db) return [];
    const rows = this.db.prepare("SELECT DISTINCT tag FROM tags ORDER BY tag").all() as { tag: string }[];
    return rows.map((r) => r.tag);
  }

  getBacklinks(notePath: string): { path: string; title: string }[] {
    if (!this.db) return [];
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
    if (!this.db) return [];
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
      "SELECT tag FROM tags WHERE note_path = ?"
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
    if (!this.db) return 0;
    const row = this.db.prepare("SELECT COUNT(*) as count FROM notes").get() as { count: number };
    return row.count;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
