# outlook-sse

Standalone service that receives Microsoft Graph webhook notifications for new Outlook mail and dispatches them through the OpenClaw mail rule pipeline.

## Architecture

```
MS Graph → HTTPS POST → Tailscale Funnel → nginx (18788) → outlook-sse (18790)
                                                          ↘ OpenClaw gateway (18789)
```

The service listens on `127.0.0.1:18790` and is exposed publicly via Tailscale Funnel + nginx reverse proxy.

## Tailscale Funnel Setup

### Current config (`tailscale serve status`)

```
https://jeff-x1yogag3.tail498490.ts.net (Funnel on)
|-- /                proxy http://127.0.0.1:18789   ← OpenClaw gateway
|-- /outlook/webhook proxy http://127.0.0.1:18790   ← outlook-sse (NOT WORKING — see below)

https://jeff-x1yogag3.tail498490.ts.net:8443 (Funnel on)
|-- / proxy http://127.0.0.1:18790
```

### Known Limitation: Path Routing Does Not Work

Tailscale Funnel's path-based routing is **broken when a catch-all `/` proxy exists on the same port**. The `/` rule swallows all traffic before the `/outlook/webhook` rule fires.

Port 8443 works for routing but **MS Graph only accepts webhook URLs on port 443**.

### Workaround: nginx Reverse Proxy

Point Funnel's `/` at nginx (18788) instead of the gateway directly. nginx splits traffic:

- `POST /outlook/webhook` → 18790 (outlook-sse)
- everything else → 18789 (OpenClaw gateway)

```nginx
server {
    listen 18788;

    location /outlook/webhook {
        proxy_pass http://127.0.0.1:18790;
    }

    location / {
        proxy_pass http://127.0.0.1:18789;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Then update Funnel:

```bash
tailscale serve --bg --set-path=/ 18788
```

And set `OUTLOOK_WEBHOOK_URL=https://jeff-x1yogag3.tail498490.ts.net/outlook/webhook`.

## Environment Variables

| Variable | Description |
|---|---|
| `OUTLOOK_CLIENT_ID` | Azure app client ID |
| `OUTLOOK_CLIENT_SECRET` | Azure app client secret |
| `OUTLOOK_REFRESH_TOKEN` | OAuth2 refresh token (Mail.Read scope) |
| `OUTLOOK_WEBHOOK_URL` | Public HTTPS URL for Graph to POST notifications |
| `OUTLOOK_WEBHOOK_PORT` | Local port to listen on (default: 18790) |
| `OUTLOOK_WEBHOOK_CLIENT_STATE` | Secret string to validate incoming Graph notifications |

## Systemd Service

```
~/.config/systemd/user/outlook-sse.service
```

```bash
systemctl --user start outlook-sse
systemctl --user status outlook-sse
journalctl --user -u outlook-sse -f
```

## Mail Rules

Rules live in `~/.openclaw/services/outlook-sse-config.json`. Same format as fastmail-sse rules. Use the `mail_rule_add` tool to add rules.

## Graph Subscription

- Max TTL: 72 hours
- Renewal check: every 30 minutes
- Renews when < 12 hours remaining
- Tenant: `consumers` (personal Microsoft account)
