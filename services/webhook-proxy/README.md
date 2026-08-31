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
                          validate X-Hub-Signature-256
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
      "path": "/hooksproxy/github-issues",
      "auth": {
        "type": "hmac-sha256",
        "header": "X-Hub-Signature-256",
        "secret_env": "GITHUB_WEBHOOK_SECRET"
      },
      "forward_path": "/hooks/github-issues"
    }
  ]
}
```

### Fields

| Field | Description |
|-------|-------------|
| `openclaw_url` | Base URL of the OpenClaw instance |
| `openclaw_bearer_env` | Env var name holding the OpenClaw hooks bearer token |
| `routes` | Array of route rules (first match wins) |
| `routes[].path` | Exact inbound path to match |
| `routes[].auth` | Auth config (see below) |
| `routes[].forward_path` | Path to forward to on OpenClaw (defaults to `path`) |

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

### systemd service

Create `/etc/systemd/system/webhook-proxy.service` (adjust paths/user as needed):

```ini
[Unit]
Description=OpenClaw Webhook Proxy
After=network.target

[Service]
Type=simple
User=openclaw
WorkingDirectory=/home/openclaw/git/openclaw-hub/services/webhook-proxy
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5
EnvironmentFile=/home/openclaw/.openclaw/services/webhook-proxy.env

[Install]
WantedBy=multi-user.target
```

Create `/home/openclaw/.openclaw/services/webhook-proxy.env`:

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

### Tailscale Funnel routing

Add the proxy path to your Tailscale Funnel config:

```bash
tailscale serve --https=443 /hooksproxy/github-issues http://127.0.0.1:18792/hooksproxy/github-issues
```

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
        "/hooksproxy/github-issues": { "Proxy": "http://127.0.0.1:18792" }
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

- The proxy listens on `127.0.0.1` only — never exposed directly to the network
- HMAC validation uses `crypto.timingSafeEqual` to prevent timing attacks
- Bearer comparison is also timing-safe
- `none` auth type should only be used for routes that are never exposed via Funnel
