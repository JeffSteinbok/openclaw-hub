# Screenshot Capture

Capture screenshots from paired OpenClaw nodes (e.g. Windows companion app).
Wraps `openclaw nodes invoke screen.snapshot`, intercepts the large base64
response (~1.3M tokens for 1080p), writes it to disk, and returns a file path
that the gateway auto-converts to a mediaId.

## Problem Solved

`nodes invoke screen.snapshot` returns the image as inline base64 — too large
to pipe into another tool call. This plugin handles the decode-and-save so the
agent gets back a small `{ file }` response that works with the `message` tool.

## Tools

| Tool | Description |
|------|-------------|
| [`screenshot_capture`](#tool-screenshot_capture) | Capture a screenshot from a paired node |

## Configuration Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `outDir` | string | No | Directory for screenshots (default: `/tmp/openclaw/screenshots`) |
| `openclawBin` | string | No | Path to openclaw binary (default: `openclaw`) |
| `gatewayUrl` | string | No | Gateway WebSocket URL (uses default config if omitted) |
| `gatewayToken` | string | No | Gateway auth token (uses default config if omitted) |
| `invokeTimeout` | number | No | Timeout in ms for node invoke (default: 30000) |

## Example config

```json
{
  "plugins": {
    "entries": {
      "screenshot-capture": {
        "enabled": true,
        "config": {}
      }
    }
  }
}
```

## Tool Parameters

<a id="tool-screenshot_capture"></a>

### `screenshot_capture`

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `node` | string | Yes | — | Node id, name, or IP (e.g. `"Windows Node (JEFFOFFICE3)"`) |
| `screenIndex` | number | No | 0 | Which monitor to capture |
| `quality` | number | No | 90 | JPEG quality 1–100 (ignored for PNG) |
| `format` | string | No | `"png"` | `"png"` or `"jpeg"` |

### Response

```json
{
  "file": "/tmp/openclaw/screenshots/windowsnodejeffoffice3_20260602_a1b2c3d4.png",
  "width": 1920,
  "height": 1080,
  "format": "png",
  "size_bytes": 1234567,
  "node": "Windows Node (JEFFOFFICE3)"
}
```

The `file` field is automatically converted to a gateway mediaId.

## Development

```bash
npm run build --workspace=plugins/screenshot-capture
npm test --workspace=plugins/screenshot-capture
```

---

Built with [Carapace Plugin SDK](https://github.com/JeffSteinbok/carapace-plugin-sdk).
