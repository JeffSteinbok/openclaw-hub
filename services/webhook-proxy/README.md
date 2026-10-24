# webhook-proxy

A lightweight auth-validating webhook proxy for OpenClaw. Sits between public webhook sources (GitHub, etc.) and the OpenClaw hooks endpoint, validating inbound auth before forwarding with the correct OpenClaw bearer token injected.

## Why this exists

OpenClaw's hooks endpoint requires a bearer token for all inbound requests. External webhook sources like GitHub use HMAC-SHA256 signatures instead. This proxy bridges the gap:

1. Receives the inbound webhook (no bearer token required from the caller)
2. Validates the caller's auth (HMAC-SHA256 or bearer)
3. Adds `Authorization: Bearer <openclaw-token>` and forwards to OpenClaw

## Architecture

```
GitHub ──► Tailscale Funnel ──► webhook-proxy :18792
                                      │
                 route by path · POST only · size limit · lockout
                                      │
                          validate X-Hub-Signature-256
                                      │
                       route filter (drop → 204, never forwarded)
                                      │
                          add Authorization: Bearer
                                      │
                               OpenClaw :18789
```

## Route auth types

| Type | Use case |
|------|----------|
| `hmac-sha256` | GitHub webhooks (`X-Hub-Signature-256`) |
| `bearer` | Services that can send a bearer token directly |
| `none` | Internal/LAN-only sources (use with caution) |

## Configuration

The proxy reads its config from `~/.openclaw/services/webhook-proxy-config.json` (override with `WEBHOOK_PROXY_CONFIG` env var).

### Schema

```json
{
  "openclaw_url": "http://127.0.0.1:18789",
  "openclaw_bearer_env": "OPENCLAW_HOOKS_TOKEN",
  "routes": [
    {
      "path": "/github-issues",
      "auth": {
        "type": "hmac-sha256",
        "header": "X-Hub-Signature-256",
        "secret_env": "GITHUB_WEBHOOK_SECRET"
      },
      "filter": {
        "type": "github-issues",
        "allowedSenders": ["your-github-login"],
        "actionableLabels": ["ilc:approved"]
      },
      "forward_path": "/hooks/github-issues"
    },
    {
      "path": "/hass",
      "auth": { "type": "bearer", "secret_env": "HOOKSPROXY_HASS_TOKEN" },
      "forward_path": "/hooks/hass"
    }
  ]
}
```

Give every sender its own route and its own secret, so one sender's credential can't be used on another route, and you can revoke one without touching the others. Only the proxy needs the real OpenClaw hooks token.

### Fields

| Field | Description |
|-------|-------------|
| `openclaw_url` | Base URL of the OpenClaw instance |
| `openclaw_bearer_env` | Env var name holding the OpenClaw hooks bearer token |
| `routes` | Array of route rules, matched by exact path |
| `routes[].path` | Exact path as the proxy receives it (query string ignored). Behind a Funnel `/hooksproxy` mount, `/hooksproxy/hass` arrives as `/hass` |
| `routes[].auth` | Auth config (see below) |
| `routes[].filter` | Optional event filter (see below). Dropped events get `204` and are not forwarded |
| `routes[].forward_path` | Path to forward to on OpenClaw (defaults to `path`) |
| `bind_host` | Interface to listen on. Default `127.0.0.1`; set a LAN address to let LAN senders reach the proxy directly |
| `max_body_bytes` | Maximum request body. Default `1048576` (1 MiB); larger bodies get `413` |
| `auth_failure_limit` | `{ max_failures, window_ms, lockout_ms }`. Default 10 failures in 60 s locks the client out for 300 s (`429`). Funnel clients are keyed by `X-Forwarded-For` |

Requests to unknown paths get `404`, and anything other than `POST` gets `405`.

### Filters

**`github-issues`** forwards only `issues` events with `action: "labeled"`, a label in `actionableLabels`, and a `sender.login` in `allowedSenders`. `ping` and everything else is dropped with `204`. It mirrors the Gateway transform, so drops happen before anything reaches OpenClaw. An unknown filter `type` drops every event (fails closed).

### Auth config

**HMAC-SHA256:**
```json
{
  "type": "hmac-sha256",
  "header": "X-Hub-Signature-256",
  "secret_env": "GITHUB_WEBHOOK_SECRET"
}
```

**Bearer:**
```json
{
  "type": "bearer",
  "secret_env": "MY_SERVICE_TOKEN"
}
```

**None (internal only):**
```json
{
  "type": "none"
}
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `WEBHOOK_PROXY_PORT` | Port to listen on (default: `18792`) |
| `WEBHOOK_PROXY_CONFIG` | Path to config file (default: `~/.openclaw/services/webhook-proxy-config.json`) |
| `OPENCLAW_HOOKS_TOKEN` | OpenClaw hooks bearer token (or whatever you set in `openclaw_bearer_env`) |
| `GITHUB_WEBHOOK_SECRET` | GitHub webhook secret (or whatever you set in each route's `secret_env`) |

## Installation

```bash
cd services/webhook-proxy
npm install
npm run build
```

### systemd service (Linux)

Create `/etc/systemd/system/webhook-proxy.service` (adjust paths/user as needed):

```ini
[Unit]
Description=OpenClaw Webhook Proxy
After=network.target

[Service]
Type=simple
User=<user>
WorkingDirectory=/home/<user>/git/openclaw-hub/services/webhook-proxy
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5
EnvironmentFile=/home/<user>/.openclaw/services/webhook-proxy.env

[Install]
WantedBy=multi-user.target
```

Create `~/.openclaw/services/webhook-proxy.env`:

```env
OPENCLAW_HOOKS_TOKEN=your-openclaw-hooks-token-here
GITHUB_WEBHOOK_SECRET=your-github-webhook-secret-here
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable webhook-proxy
sudo systemctl start webhook-proxy
```

### launchd agent (macOS)

Create `~/Library/LaunchAgents/com.openclaw.webhook-proxy.plist` (replace `<user>` and the node path with yours):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.openclaw.webhook-proxy</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>--env-file=/Users/<user>/.openclaw/services/webhook-proxy.env</string>
    <string>/Users/<user>/git/openclaw-hub/services/webhook-proxy/dist/index.js</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/<user>/Library/Logs/openclaw-webhook-proxy.log</string>
  <key>StandardErrorPath</key><string>/Users/<user>/Library/Logs/openclaw-webhook-proxy.log</string>
</dict>
</plist>
```

Load it and restart after changes:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.openclaw.webhook-proxy.plist
launchctl kickstart -k gui/$(id -u)/com.openclaw.webhook-proxy
```

### Tailscale Funnel routing

Tailscale strips the mount prefix before proxying, so mount **one** path for the whole proxy and let the proxy route by what's left:

```bash
tailscale funnel --bg --set-path=/hooksproxy http://127.0.0.1:18792
```

`https://your-host/hooksproxy/github-issues` then arrives at the proxy as `/github-issues`. Don't mount each route separately: every one would arrive as `/`.

Or via `tailscale serve` JSON (to preserve existing routes):

```bash
tailscale serve --set-raw - << 'EOF'
{
  "TCP": { "443": { "HTTPS": true } },
  "Web": {
    "your-host.tail12345.ts.net:443": {
      "Handlers": {
        "/": { "Proxy": "http://127.0.0.1:18789" },
        "/outlook/webhook": { "Proxy": "http://127.0.0.1:18790" },
        "/hooksproxy": { "Proxy": "http://127.0.0.1:18792" }
      }
    }
  },
  "AllowFunnel": { "your-host.tail12345.ts.net:443": true }
}
EOF
```

### GitHub webhook setup

In your repo → Settings → Webhooks → Add webhook:

- **Payload URL:** `https://your-host.tail12345.ts.net/hooksproxy/github-issues`
- **Content type:** `application/json`
- **Secret:** same value as `GITHUB_WEBHOOK_SECRET`
- **Events:** Issues, Pull requests (or whatever your mapping handles)

## Local config (octo)

The config file and `.env` live in `octo` (not this repo):

- Config: `~/.openclaw/services/webhook-proxy-config.json`
- Env: `~/.openclaw/services/webhook-proxy.env`
- systemd unit: managed in `octo/services/webhook-proxy/`

## Security notes

- The proxy listens on `127.0.0.1` by default; `bind_host` opts in to a LAN interface
- HMAC validation uses `crypto.timingSafeEqual` to prevent timing attacks
- Bearer comparison is also timing-safe
- Repeated auth failures lock the client out; bodies are size-limited; only `POST` is accepted
- Only a fixed allowlist of headers is forwarded to OpenClaw, so a sender can't inject headers such as identity or forwarding headers
- `none` auth type should only be used for routes that are never exposed via Funnel
