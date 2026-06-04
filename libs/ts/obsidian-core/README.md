# @openclaw/obsidian-core

Shared library for the Obsidian vault integration. Provides Markdown parsing, path security, schema DDL, and shared types used by both the **obsidian-indexer** service and the **obsidian-vault** plugin.

## Modules

| Module | Description |
|--------|-------------|
| `parser` | Frontmatter extraction (via gray-matter), inline `#tag` parsing, `[[wikilink]]` extraction, title derivation |
| `security` | Path traversal prevention, symlink escape detection, vault root canonicalization |
| `schema` | FTS5 schema DDL, `user_version` management for versioned migrations |
| `types` | Shared TypeScript interfaces (`ParsedNote`, `NoteRecord`, `SearchResult`, etc.) |

## Usage

```ts
import { parseNote, resolveSafePath, initSchema, SCHEMA_VERSION } from "@openclaw/obsidian-core";
```

Or import specific modules:

```ts
import { parseNote } from "@openclaw/obsidian-core/parser";
import { resolveSafePath } from "@openclaw/obsidian-core/security";
import { initSchema } from "@openclaw/obsidian-core/schema";
```

## Testing

```bash
npm test -w libs/ts/obsidian-core
```
