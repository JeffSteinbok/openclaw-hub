/**
 * Shared types for obsidian-core.
 *
 * Used by both the indexer service and the vault query plugin.
 */

// ---------------------------------------------------------------------------
// Note types
// ---------------------------------------------------------------------------

export interface ParsedNote {
  title: string;
  content: string;
  frontmatter: Record<string, unknown>;
  tags: string[];
  wikilinks: WikiLink[];
}

export interface WikiLink {
  target: string;
  alias: string | null;
}

// ---------------------------------------------------------------------------
// Index types (DB row shapes)
// ---------------------------------------------------------------------------

export interface NoteRecord {
  path: string;
  title: string;
  content: string;
  frontmatter_json: string;
  mtime_ms: number;
}

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  rank: number;
}

export interface RecentNote {
  path: string;
  title: string;
  mtime_ms: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface VaultConfig {
  vaultRoot: string;
  indexLocation: string;
}

/** Current schema version — bumped on breaking schema changes. */
export const SCHEMA_VERSION = 1;
