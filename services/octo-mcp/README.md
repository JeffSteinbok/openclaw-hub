# octo-mcp

MCP server that lets OctoDot (a ChatGPT Dot) reach OpenClaw.

**Status: spike (octo#441).** One read-only `ping` tool and no auth, to prove a Dot can call a custom MCP server
before building OAuth. octo#442 adds WorkOS OAuth and the `ask_octo` tool; until then it has no access to OpenClaw.

- Streamable HTTP, stateless (a fresh `McpServer` per request), JSON responses.
- Listens on `127.0.0.1:18793`, path `/mcp`. Everything else is 404; methods other than POST are 405.
- Public URL: `https://<funnel-host>:8443/mcp` (Tailscale Funnel on its own port, so no prefix stripping).
- Rejects a `Host` header outside `OCTO_MCP_ALLOWED_HOSTS` with 421 (DNS rebinding guard) and bodies over 1 MiB with 413.

```bash
npm install && npm run build && npm test
OCTO_MCP_PORT=18793 node dist/index.js
```

| Env | Default |
|---|---|
| `OCTO_MCP_PORT` | `18793` |
| `OCTO_MCP_ALLOWED_HOSTS` | `127.0.0.1:<port>,localhost:<port>,<funnel-host>:8443,<funnel-host>` |

Runs as the LaunchAgent `com.octo.openclaw.octo-mcp` (plist in the octo repo, `config/macos/launchd/`). Log:
`~/Library/Logs/openclaw-octo-mcp.log`.
