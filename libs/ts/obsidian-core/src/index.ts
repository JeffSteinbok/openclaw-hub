/**
 * @openclaw/obsidian-core — shared library for the Obsidian vault indexer and plugin.
 *
 * Provides note parsing, path security, schema DDL, and shared types.
 */

// Types
export type {
  ParsedNote,
  WikiLink,
  NoteRecord,
  SearchResult,
  RecentNote,
  VaultConfig,
} from "./types.js";
export { SCHEMA_VERSION } from "./types.js";

// Parser
export {
  parseFrontmatter,
  extractTags,
  extractWikilinks,
  deriveTitle,
  parseNote,
} from "./parser.js";

// Security
export {
  resolveSafePath,
  canonicalizeVaultRoot,
  validateIndexLocation,
} from "./security.js";

// Schema
export {
  SCHEMA_DDL,
  initSchema,
  validateSchemaVersion,
} from "./schema.js";
