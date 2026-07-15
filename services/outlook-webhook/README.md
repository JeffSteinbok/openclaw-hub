# outlook-webhook

Standalone service that receives Microsoft Graph webhook notifications for new Outlook mail and dispatches them through the OpenClaw mail rule pipeline — the Outlook equivalent of `fastmail-sse`.

## Architecture

```
MS Graph → HTTPS POST → Tailscale Funnel → webhook-proxy (18788) → outlook-webhook (18790)
                                                                   ↘ OpenClaw gateway (18789)
```

The service listens on `127.0.0.1:18790`. Tailscale Funnel exposes it publicly via the `webhook-proxy` service, which routes `/outlook/webhook` to port 18790 and everything else to the OpenClaw gateway on port 18789.

## How It Works

1. On startup, the service registers a MS Graph change notification subscription pointing at the public webhook URL
2. MS Graph POSTs a notification to the URL whenever a new message arrives in the inbox
3. The service fetches the full message from Graph and feeds it through `carapace-mail-runtime`
4. Rules are evaluated; actions fire (notify, agent wake, silent log, etc.)
5. The subscription auto-renews every 30 minutes (Graph subscriptions expire after max 72 hours)

## Setup

### 1. Environment variables

Add to `.env`:

| Variable | Description |
|---|---|
| `OUTLOOK_CLIENT_ID` | Azure app client ID |
| `OUTLOOK_CLIENT_SECRET` | Azure app client secret |
| `OUTLOOK_REFRESH_TOKEN` | OAuth2 refresh token (requires `Mail.Read` scope) |
| `OUTLOOK_WEBHOOK_URL` | Public HTTPS URL Graph will POST to (e.g. `https://jeff-x1yogag3.tail498490.ts.net/outlook/webhook`) |
| `OUTLOOK_WEBHOOK_PORT` | Local port to listen on (default: `18790`) |
| `OUTLOOK_WEBHOOK_CLIENT_STATE` | Secret string to validate incoming Graph notifications (generate once, keep secret) |

### 2. Webhook proxy routing

The `webhook-proxy` service (also in `openclaw-hub/services/webhook-proxy`) must route `/outlook/webhook` to port 18790. Add a route entry in its config:

```json
{
  "path": "/outlook/webhook",
  "target": "http://127.0.0.1:18790",
  "auth": "none"
}
```

### 3. Build and start

```bash
cd services/outlook-webhook
npm install
npm run build
node dist/index.js
```

### 4. Systemd service

```ini
# ~/.config/systemd/user/outlook-webhook.service
[Unit]
Description=OpenClaw Outlook Webhook Service
After=network.target

[Service]
ExecStart=/usr/bin/node /home/openclaw/git/openclaw-hub/services/outlook-webhook/dist/index.js
Restart=on-failure
RestartSec=10
EnvironmentFile=%h/.openclaw/.env

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now outlook-webhook
systemctl --user status outlook-webhook
journalctl --user -u outlook-webhook -f
```

## Mail Rules

Rules live in `~/.openclaw/services/outlook-webhook-config.json`. Same format as `fastmail-sse` rules. Use the `mail_rule_add` tool to add rules via the OpenClaw agent.

## Graph Subscription Details

- **Resource:** `me/mailFolders/inbox/messages`
- **Change type:** `created`
- **Max TTL:** 72 hours
- **Renewal check:** every 30 minutes
- **Renews when:** < 12 hours remaining
- **Tenant:** `consumers` (personal Microsoft account)

## Source

Part of [openclaw-hub](https://github.com/JeffSteinbok/openclaw-hub). Modeled on `fastmail-sse`.
