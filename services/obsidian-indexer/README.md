# Obsidian Indexer Service

A standalone service that builds and maintains an FTS5 search index for an [Obsidian](https://obsidian.md) vault. Designed to run as a systemd user service alongside the OpenClaw gateway.

## Architecture

```
┌─────────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  obsidian-indexer    │     │  SQLite DB (WAL)  │     │  obsidian-vault  │
│  (this service)      │────▶│  FTS5 index       │◀────│  (gateway plugin)│
│  writes + watches    │     │                   │     │  reads only      │
└─────────────────────┘     └──────────────────┘     └──────────────────┘
```

The indexer is the **sole writer** to the SQLite database. The vault plugin and CLI open the database **read-only**. SQLite WAL mode supports this concurrency model natively.

## Features

- **Full vault scan** on startup with stale-note reconciliation
- **Incremental updates** via chokidar file watcher
- **Schema versioning** via `PRAGMA user_version`
- **WAL checkpoint** on graceful shutdown
- **Structured logging** with configurable log level
- **Periodic stats** reporting (every 5 minutes when changes occur)

## Configuration

| Environment Variable | Required | Default | Description |
|---------------------|----------|---------|-------------|
| `OBSIDIAN_VAULT_ROOT` | Yes | — | Absolute path to the Obsidian vault directory |
| `OBSIDIAN_INDEX_LOCATION` | No | `~/.openclaw/obsidian-index.db` | Path for the SQLite index database |
| `LOG_LEVEL` | No | `info` | Log level: `debug`, `info`, `warn`, `error` |

## systemd Service

Install as a systemd user service:

```bash
cp obsidian-indexer.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now obsidian-indexer
```

Check status and logs:

```bash
systemctl --user status obsidian-indexer
journalctl --user -u obsidian-indexer -f
```

## Development

```bash
# Build
npm run build -w services/obsidian-indexer

# Run locally
OBSIDIAN_VAULT_ROOT=~/OneDrive/JeffBrain node dist/index.js

# Test
npm test -w services/obsidian-indexer
```

## Testing

The test suite covers:

- Full vault scan (note count, FTS5, tags, wikilinks, frontmatter, schema version)
- Stale-note reconciliation (files deleted while service was stopped)
- File watcher (add, modify, delete, ignore non-md, ignore dotfiles)
- Graceful shutdown with WAL checkpoint
- Error handling (missing vault, index inside vault)
