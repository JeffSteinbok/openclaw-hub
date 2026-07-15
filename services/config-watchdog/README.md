# config-watchdog

A daemon that watches the OpenClaw config file (`openclaw.json`) and automatically recovers the gateway if a bad config is detected.

## What it does

On every config file change:

1. **Rotates backups** — keeps up to `WATCHDOG_BACKUP_VERSIONS` numbered copies (`.bak`, `.bak.1`, `.bak.2`, …)
2. **Health-checks the gateway** — hits the HTTP health endpoint
3. **If healthy** — stamps `openclaw.json.last-good` and moves on
4. **If unhealthy** — runs the recovery ladder:
   - Swap in `openclaw.json.last-good` → restart → check
   - Try each numbered backup in order → restart → check
   - Run `openclaw doctor fix` → restart → check
   - **If all fail**: file a GitHub issue on `JeffSteinbok/octo` with the `doctor` output and give up

Bad configs are stashed as `openclaw.json.bad.<timestamp>` — nothing is ever deleted.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `OPENCLAW_CONFIG_FILE` | `~/.openclaw/openclaw.json` | Path to the config file to watch |
| `OPENCLAW_CONFIG_DIR` | `~/.openclaw` | Directory for backup files |
| `WATCHDOG_BACKUP_VERSIONS` | `10` | Number of numbered backup slots |
| `WATCHDOG_DEBOUNCE_MS` | `500` | Debounce delay for fs.watch events |
| `WATCHDOG_HEALTH_TIMEOUT_MS` | `30000` | Max ms to wait for gateway after restart |
| `WATCHDOG_HEALTH_POLL_INTERVAL_MS` | `2000` | Ms between health polls |
| `OPENCLAW_GATEWAY_URL` | `http://127.0.0.1:18789` | Gateway base URL |
| `OPENCLAW_GATEWAY_AUTH_TOKEN` | _(none)_ | Bearer token for health endpoint |
| `OPENCLAW_SYSTEMD_UNIT` | `openclaw-gateway.service` | systemd unit to restart |
| `GITHUB_TOKEN` | _(required for incidents)_ | GitHub token for filing issues |
| `WATCHDOG_GITHUB_OWNER` | `JeffSteinbok` | GitHub repo owner |
| `WATCHDOG_GITHUB_REPO` | `octo` | GitHub repo name |

## Building

```bash
cd services/config-watchdog
npm run build
```

Or from the workspace root:

```bash
npm run build
```

## Running as a systemd service

See `config-watchdog.service` for the unit file. Install with:

```bash
cp config-watchdog.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now config-watchdog.service
```

## Recovery sequence detail

```
config changed
    │
    ├─ rotate backups (.bak, .bak.1, …)
    │
    ├─ health check (1.5s after change)
    │
    ├─ HEALTHY → stamp last-good → done ✅
    │
    └─ UNHEALTHY → recovery ladder:
           │
           ├─ swap last-good → restart → health poll 30s
           │       HEALTHY → done ✅
           │
           ├─ swap .bak → restart → health poll 30s
           │       HEALTHY → done ✅
           │
           ├─ swap .bak.1 … .bak.N → restart → health poll 30s
           │       HEALTHY → done ✅
           │
           ├─ openclaw doctor fix → restart → health poll 30s
           │       HEALTHY → done ✅
           │
           └─ file GitHub issue (JeffSteinbok/octo) with doctor output
                   GIVE UP 🛑
```
