/**
 * Schema — DDL for the Obsidian vault FTS5 index.
 *
 * Shared between the indexer (which creates/migrates) and the plugin
 * (which validates on open). Uses PRAGMA user_version for versioning.
 */

import { SCHEMA_VERSION } from "./types.js";
import type Database from "better-sqlite3";

/**
 * SQL statements that create the full schema.
 * The indexer runs these once on first boot.
 */
export const SCHEMA_DDL = `
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
`;

/**
 * Initialize the schema and set the version pragma.
 * Called by the indexer service on startup.
 */
export function initSchema(db: Database.Database): void {
  db.exec(SCHEMA_DDL);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

/**
 * Validate that the DB has the expected schema version.
 * Called by the read-only plugin on open.
 *
 * @returns true if schema version matches, false otherwise
 */
export function validateSchemaVersion(db: Database.Database): boolean {
  const row = db.pragma("user_version", { simple: true });
  return Number(row) === SCHEMA_VERSION;
}
