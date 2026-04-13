# Config Backup

Keep a versioned backup of the OpenClaw config and workspace in Git. This plugin is designed for unattended backup runs and only creates a commit when tracked content has actually changed.

## Tools

| Tool | Description |
|------|-------------|
| `config_backup_run` | Back up OpenClaw config and agent workspace to Git |

### `config_backup_run`

Copies `~/.openclaw` config files into the Git repo, commits, and pushes — only when content has changed (SHA-256 hash comparison). No parameters required.

## Notes

- Designed to run as a cron job.
- Uses SHA-256 hash comparison to skip redundant commits.
- No environment variables needed — operates on the local Git repo.

## Plugin Structure

```
openclaw.plugin.json
src/tools.py
src/backup_config.py
```
