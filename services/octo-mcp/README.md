# octo-mcp

MCP server that lets OctoDot (a ChatGPT Dot) reach OpenClaw.

**Status:** OAuth in place, one read-only `ping` tool (octo#441). The `ask_octo` tool comes in octo#442; until then the
server has no access to OpenClaw.

- Streamable HTTP, stateless (a fresh `McpServer` per request), JSON responses.
- Listens on `127.0.0.1:18793`, path `/mcp`. Public URL: `https://octo.tail498490.ts.net:8443/mcp` (Tailscale Funnel on
  its own port, so no prefix stripping).
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
the resource indicator `https://octo.tail498490.ts.net:8443/mcp` and set it as the default, and disable public sign-up.

## Run

```bash
npm install && npm run build && npm test
OCTO_MCP_AUTHKIT_ISSUER=https://<subdomain>.authkit.app OCTO_MCP_ALLOWED_SUBJECTS=user_… node dist/index.js
```

| Env | Default |
|---|---|
| `OCTO_MCP_PORT` | `18793` |
| `OCTO_MCP_ALLOWED_HOSTS` | `127.0.0.1:<port>,localhost:<port>,octo.tail498490.ts.net:8443,octo.tail498490.ts.net` |
| `OCTO_MCP_AUTHKIT_ISSUER` | none (required) |
| `OCTO_MCP_RESOURCE` | `https://octo.tail498490.ts.net:8443/mcp` |
| `OCTO_MCP_ALLOWED_SUBJECTS` | empty (nobody) |

Runs as the LaunchAgent `com.octo.openclaw.octo-mcp` (plist in the octo repo, `config/macos/launchd/`). None of these
values are secrets. Log: `~/Library/Logs/openclaw-octo-mcp.log`.
