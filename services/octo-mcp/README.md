# octo-mcp

MCP server that lets OctoDot (a ChatGPT Dot) reach OpenClaw.

**Tools:** `ping`, and `ask_octo`, which sends a question to OpenClaw's dedicated `external` agent and returns its
reply (octo#442). For that, octo-mcp is paired with the Gateway as its own operator device with only `operator.read`
and `operator.write`, through [`@openclaw/gateway-client`](https://docs.openclaw.ai/gateway/clients): it can chat with
agents but can't change config, pair devices or administer the Gateway. It never holds the shared Gateway token.

- Streamable HTTP, stateless (a fresh `McpServer` per request), JSON responses.
- Listens on `127.0.0.1:18793`, path `/mcp`. Public URL: `https://octo.tail498490.ts.net/mcp`. Tailscale Funnel on
  :443 mounts `/mcp`, `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` onto the
  same paths here; everything else on :443 is the OpenClaw Gateway. ChatGPT doesn't connect to non-443 ports (it never
  requested anything from the :8443 spike), so the server can't have its own Funnel port.
- Rejects a `Host` header outside `OCTO_MCP_ALLOWED_HOSTS` with 421 (DNS rebinding guard), bodies over 1 MiB with 413,
  other paths with 404 and methods other than POST with 405.

## Auth

WorkOS AuthKit is the authorization server; this service is only the resource server.

- `GET /.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp` (RFC 9728):
  `resource`, `authorization_servers: [<issuer>]`, `bearer_methods_supported: ["header"]`.
- `GET /.well-known/oauth-authorization-server`: AuthKit's metadata, proxied (WorkOS compatibility fallback).
- Every `POST /mcp` needs `Authorization: Bearer <AuthKit access token>`, checked before the body is read:
  signature against `<issuer>/oauth2/jwks`, `iss` = issuer, `aud` = `OCTO_MCP_RESOURCE`, `exp`, and `sub` in
  `OCTO_MCP_ALLOWED_SUBJECTS`.
  - Missing or invalid token: `401` with `WWW-Authenticate: Bearer resource_metadata="…", error="invalid_token", …`.
  - Valid token, `sub` not allowed: `403` with `error="insufficient_scope"`. The log records the `sub`, which is how
    you find your WorkOS user id the first time.
- Without `OCTO_MCP_AUTHKIT_ISSUER` (an `https://` origin) the service exits instead of starting.

WorkOS dashboard: enable Client ID Metadata Document and Dynamic Client Registration (Connect → Configuration), add
the resource indicator `https://octo.tail498490.ts.net/mcp` and set it as the default, and disable public sign-up.

## Pairing with OpenClaw (once)

```bash
OPENCLAW_GATEWAY_TOKEN=… node dist/pair.js     # the shared token is used for this connection only, never stored
openclaw devices approve <requestId>           # on the Gateway host, if it wasn't auto-approved
node dist/pair.js                               # stores the device token
```

The identity (`device.json`, Ed25519) and device token (`token.json`) live in `OCTO_MCP_DEVICE_DIR`
(default `~/.openclaw/secrets/octo-mcp`, mode 700/600). Until they exist, `ask_octo` isn't offered. To revoke,
`openclaw devices remove <deviceId>` and delete the directory.

`ask_octo` sends `chat.send` to session `agent:<agent>:mcp` with delivery off and slash-command interpretation
suppressed, waits with `agent.wait`, and reads the reply with the client's `recoverTerminalReply`.

## Run

```bash
npm install && npm run build && npm test
OCTO_MCP_AUTHKIT_ISSUER=https://<subdomain>.authkit.app OCTO_MCP_ALLOWED_SUBJECTS=user_… node dist/index.js
```

| Env | Default |
|---|---|
| `OCTO_MCP_PORT` | `18793` |
| `OCTO_MCP_DEVICE_DIR` | `~/.openclaw/secrets/octo-mcp` |
| `OCTO_MCP_GATEWAY_URL` | `ws://127.0.0.1:18789` |
| `OCTO_MCP_AGENT` | `external` |
| `OCTO_MCP_ALLOWED_HOSTS` | `127.0.0.1:<port>,localhost:<port>,octo.tail498490.ts.net` |
| `OCTO_MCP_AUTHKIT_ISSUER` | none (required) |
| `OCTO_MCP_RESOURCE` | `https://octo.tail498490.ts.net/mcp` |
| `OCTO_MCP_ALLOWED_SUBJECTS` | empty (nobody) |

Runs as the LaunchAgent `com.octo.openclaw.octo-mcp` (plist in the octo repo, `config/macos/launchd/`). None of these
values are secrets. Log: `~/Library/Logs/openclaw-octo-mcp.log`.
