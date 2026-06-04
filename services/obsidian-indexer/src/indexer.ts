/**
 * Indexer — builds and maintains the FTS5 search index for an Obsidian vault.
 *
 * Responsibilities:
 * - Full vault scan on startup with stale-note reconciliation
 * - Chokidar file watcher for incremental updates
 * - WAL mode for concurrent readers (plugin/CLI)
 * - Schema versioning via PRAGMA user_version
 */

import { readFileSync, statSync, readdirSync, mkdirSync } from "node:fs";
import { join, relative, dirname, extname, basename } from "node:path";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { watch } from "chokidar";
import type { FSWatcher } from "chokidar";
import {
  parseNote,
  canonicalizeVaultRoot,
  validateIndexLocation,
  initSchema,
  type VaultConfig,
} from "@openclaw/obsidian-core";
import { log } from "./log.js";

// ---------------------------------------------------------------------------
// Indexer class
// ---------------------------------------------------------------------------

export class VaultIndexer {
  private db: BetterSqlite3.Database;
  private vaultRoot: string;
  private watcher: FSWatcher | null = null;
  private statsInterval: ReturnType<typeof setInterval> | null = null;
  private changesSinceLastLog = 0;

  constructor(config: VaultConfig) {
    this.vaultRoot = canonicalizeVaultRoot(config.vaultRoot);
    validateIndexLocation(this.vaultRoot, config.indexLocation);

    // Ensure index directory exists
    mkdirSync(dirname(config.indexLocation), { recursive: true });

    this.db = new Database(config.indexLocation);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");

    initSchema(this.db);

    log.info("indexer initialized", {
      vaultRoot: this.vaultRoot,
      indexLocation: config.indexLocation,
    });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Start the full vault scan + file watcher.
   * Returns when the initial scan is complete; the watcher runs indefinitely.
   */
  async start(): Promise<void> {
    const startMs = Date.now();

    log.info("starting full vault scan...");
    const { indexed, removed } = this.performFullScan();
    const elapsedMs = Date.now() - startMs;
    log.info("full scan complete", { indexed, removed, elapsedMs });

    await this.startWatcher();
    this.startStatsLogger();
  }

  /**
   * Graceful shutdown — stop watcher, checkpoint WAL, close DB.
   */
  async shutdown(): Promise<void> {
    log.info("shutting down...");

    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      log.info("file watcher stopped");
    }

    // Checkpoint WAL to main DB for clean state
    try {
      this.db.pragma("wal_checkpoint(TRUNCATE)");
      log.info("WAL checkpoint complete");
    } catch (e) {
      log.warn("WAL checkpoint failed", { error: String(e) });
    }

    this.db.close();
    log.info("database closed");
  }

  /** Get current note count (for testing/monitoring). */
  getNoteCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM notes").get() as { count: number };
    return row.count;
  }

  // -------------------------------------------------------------------------
  // Full scan
  // -------------------------------------------------------------------------

  private performFullScan(): { indexed: number; removed: number } {
    const files = this.collectMarkdownFiles(this.vaultRoot);
    const currentPaths = new Set<string>();

    const insertNote = this.db.prepare(`
      INSERT OR REPLACE INTO notes (path, title, content, frontmatter_json, mtime_ms)
      VALUES (@path, @title, @content, @frontmatter_json, @mtime_ms)
    `);
    const insertTag = this.db.prepare(
      "INSERT OR REPLACE INTO tags (note_path, tag) VALUES (@note_path, @tag)"
    );
    const insertLink = this.db.prepare(
      "INSERT INTO links (source_path, target, alias) VALUES (@source_path, @target, @alias)"
    );
    const deleteLinks = this.db.prepare("DELETE FROM links WHERE source_path = ?");
    const deleteTags = this.db.prepare("DELETE FROM tags WHERE note_path = ?");

    let indexed = 0;

    // Batch insert for performance
    const batchSize = 100;
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      const txn = this.db.transaction(() => {
        for (const filePath of batch) {
          const relPath = relative(this.vaultRoot, filePath);
          currentPaths.add(relPath);

          if (this.indexSingleFile(filePath, insertNote, insertTag, insertLink, deleteLinks, deleteTags)) {
            indexed++;
          }
        }
      });
      txn();
    }

    // Reconcile: remove stale notes no longer on disk
    const removed = this.reconcileStaleNotes(currentPaths);

    return { indexed, removed };
  }

  /**
   * Remove notes from DB that are no longer present on disk.
   * Prevents stale entries from files deleted while the service was stopped.
   */
  private reconcileStaleNotes(currentPaths: Set<string>): number {
    const dbPaths = this.db
      .prepare("SELECT path FROM notes")
      .all() as { path: string }[];

    let removed = 0;
    const deleteNote = this.db.prepare("DELETE FROM notes WHERE path = ?");

    const txn = this.db.transaction(() => {
      for (const row of dbPaths) {
        if (!currentPaths.has(row.path)) {
          deleteNote.run(row.path);
          removed++;
          log.debug("removed stale note", { path: row.path });
        }
      }
    });
    txn();

    if (removed > 0) {
      log.info("reconciled stale notes", { removed });
    }

    return removed;
  }

  // -------------------------------------------------------------------------
  // Single file indexing
  // -------------------------------------------------------------------------

  private indexSingleFile(
    absolutePath: string,
    insertNote: BetterSqlite3.Statement,
    insertTag: BetterSqlite3.Statement,
    insertLink: BetterSqlite3.Statement,
    deleteLinks: BetterSqlite3.Statement,
    deleteTags: BetterSqlite3.Statement,
  ): boolean {
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

      return true;
    } catch (e) {
      log.warn("failed to index file", {
        path: absolutePath,
        error: String(e),
      });
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // File discovery
  // -------------------------------------------------------------------------

  private collectMarkdownFiles(dir: string): string[] {
    const files: string[] = [];
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;

        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...this.collectMarkdownFiles(fullPath));
        } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
          files.push(fullPath);
        }
        // Skip symlinks
      }
    } catch (e) {
      log.warn("failed to read directory", { dir, error: String(e) });
    }
    return files;
  }

  // -------------------------------------------------------------------------
  // File watcher
  // -------------------------------------------------------------------------

  private startWatcher(): Promise<void> {
    log.info("starting file watcher...");

    return new Promise((resolve) => {
      this.watcher = watch(this.vaultRoot, {
        ignored: /(^|[/\\])\./,
        persistent: true,
        followSymlinks: false,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      });

      const stmts = this.prepareStatements();

      this.watcher
        .on("add", (path) => this.onFileChange(path, stmts))
        .on("change", (path) => this.onFileChange(path, stmts))
        .on("unlink", (path) => this.onFileRemove(path))
        .on("ready", () => {
          log.info("file watcher ready");
          resolve();
        })
        .on("error", (err) => log.error("file watcher error", { error: String(err) }));
    });
  }

  private prepareStatements() {
    return {
      insertNote: this.db.prepare(`
        INSERT OR REPLACE INTO notes (path, title, content, frontmatter_json, mtime_ms)
        VALUES (@path, @title, @content, @frontmatter_json, @mtime_ms)
      `),
      insertTag: this.db.prepare(
        "INSERT OR REPLACE INTO tags (note_path, tag) VALUES (@note_path, @tag)"
      ),
      insertLink: this.db.prepare(
        "INSERT INTO links (source_path, target, alias) VALUES (@source_path, @target, @alias)"
      ),
      deleteLinks: this.db.prepare("DELETE FROM links WHERE source_path = ?"),
      deleteTags: this.db.prepare("DELETE FROM tags WHERE note_path = ?"),
    };
  }

  private onFileChange(
    absolutePath: string,
    stmts: ReturnType<typeof this.prepareStatements>,
  ): void {
    if (extname(absolutePath).toLowerCase() !== ".md") return;

    const relPath = relative(this.vaultRoot, absolutePath);

    // Wrap in transaction for atomicity
    const txn = this.db.transaction(() => {
      this.indexSingleFile(
        absolutePath,
        stmts.insertNote,
        stmts.insertTag,
        stmts.insertLink,
        stmts.deleteLinks,
        stmts.deleteTags,
      );
    });

    try {
      txn();
      this.changesSinceLastLog++;
      log.debug("indexed file change", { path: relPath });
    } catch (e) {
      log.warn("failed to index file change", { path: relPath, error: String(e) });
    }
  }

  private onFileRemove(absolutePath: string): void {
    if (extname(absolutePath).toLowerCase() !== ".md") return;

    const relPath = relative(this.vaultRoot, absolutePath);
    try {
      this.db.prepare("DELETE FROM notes WHERE path = ?").run(relPath);
      this.changesSinceLastLog++;
      log.info("removed deleted note", { path: relPath });
    } catch (e) {
      log.warn("failed to remove note", { path: relPath, error: String(e) });
    }
  }

  // -------------------------------------------------------------------------
  // Periodic stats logging
  // -------------------------------------------------------------------------

  private startStatsLogger(): void {
    // Log stats every 5 minutes
    this.statsInterval = setInterval(() => {
      const count = this.getNoteCount();
      const changes = this.changesSinceLastLog;
      this.changesSinceLastLog = 0;

      if (changes > 0) {
        log.info("stats", { noteCount: count, changesSinceLast: changes });
      }
    }, 5 * 60 * 1000);

    // Don't keep the process alive just for stats logging
    if (this.statsInterval.unref) {
      this.statsInterval.unref();
    }
  }
}
