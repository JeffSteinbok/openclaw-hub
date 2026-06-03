# Media Store Write

Decode base64-encoded bytes and write them to the OpenClaw gateway media store.
Returns a file path that the gateway automatically converts to a mediaId for
attaching to Discord/Telegram messages.

## Problem Solved

When `nodes(action="invoke", invokeCommand="screen.snapshot")` returns a
screenshot, the payload contains raw base64 PNG data. There is no built-in way
for the agent to attach this directly to a message — the `message` tool only
accepts URLs or gateway media IDs.

The `hass_camera_snapshot` tool works because it writes a file and returns
`{ file: "/path/..." }`, which the gateway converts to a media ID. This plugin
does the same for any base64 payload.

## Tools

| Tool | Description |
|------|-------------|
| [`media_write`](#tool-media_write) | Decode base64 bytes and write to the media store |

## Configuration Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mediaDir` | string | Optional | Directory where media files are written |

## Example config

Set under `plugins.entries["media-store-write"].config`:

```json
{
  "plugins": {
    "entries": {
      "media-store-write": {
        "enabled": true,
        "config": {
          "mediaDir": "/tmp/openclaw/media_store"
        }
      }
    }
  }
}
```

If omitted, the plugin defaults to `/tmp/openclaw/media_store`.

## Tool Parameters

<a id="tool-media_write"></a>

### `media_write`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `base64` | string | Yes | Base64-encoded file content (standard or URL-safe encoding; padding optional) |
| `mimeType` | string | Yes | MIME type of the content, e.g. `image/png`, `image/jpeg`, `application/pdf` |
| `filename` | string | No | Hint for the stored filename (basename only; a timestamp suffix is always appended) |

### Response

On success:
```json
{
  "file": "/tmp/openclaw/media_store/screenshot_20260602_a1b2c3d4.png",
  "mediaId": "/tmp/openclaw/media_store/screenshot_20260602_a1b2c3d4.png",
  "size_bytes": 1234,
  "mimeType": "image/png"
}
```

The `file` field is automatically converted to a gateway mediaId by OpenClaw and
can be passed to the `message` tool's `media` or `attachments` parameter.

On failure: `{ "error": "..." }`

### Supported MIME types

`image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/bmp`, `image/svg+xml`,
`image/tiff`, `application/pdf`, `text/plain`, `text/html`, `application/json`,
`video/mp4`, `video/webm`, `audio/mpeg`, `audio/wav`, `application/zip`.
Unknown types default to `.bin`.

## Security

- Filename hints are sanitized: path traversal (`../../etc/passwd`) is stripped,
  only alphanumeric characters, hyphens, and underscores are kept.
- Files are always written to the configured `mediaDir` directory.

## Development

### Build

```bash
npm run build --workspace=plugins/media-store-write
```

### Test

```bash
npm test --workspace=plugins/media-store-write
```

---

## CLI Usage

Built with [Carapace Plugin SDK](https://github.com/JeffSteinbok/carapace-plugin-sdk).

All tools are also available as a standalone CLI:

```bash
cd plugins/media-store-write
npm install && npm run build
node dist/bin/media-store-write.js --help
```

### Example commands

```bash
node dist/bin/media-store-write.js media-write --base64 "iVBOR..." --mime-type "image/png"

# JSON output
node dist/bin/media-store-write.js media-write --base64 "..." --mime-type "image/png" --json
```

### CLI Environment Variables

| Variable | Description |
|----------|-------------|
| `MEDIA_STORE_WRITE_MEDIA_DIR` | Directory where media files are written (default: `/tmp/openclaw/media_store`) |
