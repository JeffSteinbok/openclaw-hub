# Obsidian Vault Plugin

Read-only OpenClaw plugin for querying an [Obsidian](https://obsidian.md) vault. Provides full-text search, note reading, tag browsing, backlinks, and related-note discovery.

## Architecture

This plugin is **read-only** — it queries a pre-built FTS5 SQLite index but never writes to it. The index is built and maintained by the companion **[obsidian-indexer](../../services/obsidian-indexer/)** service.

```
obsidian-indexer (service)  ──writes──▶  SQLite DB (WAL)  ◀──reads──  obsidian-vault (this plugin)
```

Shared parsing and security logic lives in **[@openclaw/obsidian-core](../../libs/ts/obsidian-core/)**.

## Tools (6)

| Tool | Description |
|------|-------------|
| `vault_search` | Full-text search with prefix matching and LIKE fallback. Supports FTS5 syntax (`OR`, `AND`, `NEAR`). |
| `vault_read` | Read a single note — returns content, frontmatter, tags, and wikilinks. Reads directly from disk for freshest content. |
| `vault_recent` | List recently modified notes, sorted by modification time. |
| `vault_tags` | List all tags across the vault. |
| `vault_backlinks` | Find notes that link to a given note via `[[wikilinks]]`. |
| `vault_related` | Find related notes via shared wikilinks and tags, ranked by relevance. |

## Configuration

```json
{
  "obsidian-vault": {
    "vaultRoot": "/home/user/OneDrive/MyVault",
    "indexLocation": "~/.openclaw/obsidian-index.db"
  }
}
```

| Key | Required | Default | Description |
|-----|----------|---------|-------------|
| `vaultRoot` | Yes | — | Absolute path to the Obsidian vault root |
| `indexLocation` | No | `~/.openclaw/obsidian-index.db` | Path to the SQLite index (must be outside vault) |

## Prerequisites

The **obsidian-indexer** service must be running to maintain the search index:

```bash
systemctl --user enable --now obsidian-indexer
```

The plugin gracefully handles a missing or empty index — it reports the status rather than crashing.

## Search Features

- **Prefix matching**: `wash` finds `washer`, `washing`, `washroom`
- **OR queries**: `washer OR "washing machine" OR laundry`
- **LIKE fallback**: if FTS5 returns nothing, falls back to substring search
- **FTS5 syntax**: full support for `AND`, `OR`, `NOT`, `NEAR`, `"phrase"`, `prefix*`

## Testing

```bash
npm test -w plugins/obsidian-vault
```

## CLI

The plugin also generates a standalone CLI via Carapace:

```bash
obsidian-vault vault-search --query "battery monitoring" --json
```

Requires `OBSIDIAN_VAULT_VAULT_ROOT` and `OBSIDIAN_VAULT_INDEX_LOCATION` environment variables.
