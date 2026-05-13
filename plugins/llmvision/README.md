# Home Assistant – LLM Vision

Home Assistant LLM Vision integration for Octo. This plugin exposes Python-backed tools that query the LLM Vision timeline, download timeline keyframes, trigger new image analysis runs, and create timeline events through the Home Assistant REST API.

## Tools

| Tool | Description |
|------|-------------|
| `llmvision_timeline_get` | List timeline events from the LLM Vision timeline API |
| `llmvision_get_image` | Download a timeline keyframe image from Home Assistant media storage |
| `llmvision_analyze_image` | Trigger a fresh AI image analysis run for a camera entity |
| `llmvision_create_event` | Create a new event in the LLM Vision timeline |

## Configuration Schema

```json
{
  "server": "http://192.168.1.123:8123",
  "token": "your_long_lived_access_token"
}
```

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `server` | string | Yes | Home Assistant server URL |
| `token` | string | Yes | Home Assistant long-lived access token |

## Example config

Set credentials in `plugins.entries["llmvision"].config`:

```json
{
  "plugins": {
    "entries": {
      "llmvision": {
        "enabled": true,
        "config": {
          "server": "http://192.168.1.123:8123",
          "token": "your_long_lived_access_token"
        }
      }
    }
  }
}
```

Uses the same Home Assistant credentials as the homeassistant plugin.

## Development

### Build

```bash
npm run build --workspace=plugins/llmvision
```

---

## CLI Usage

Built with [Carapace Plugin SDK](https://github.com/JeffSteinbok/carapace-plugin-sdk).

All tools are also available as a standalone CLI:

```bash
cd plugins/llmvision
npm install && npm run build
node dist/bin/llmvision.js --help
```

### Example commands

```bash
node dist/bin/llmvision.js llmvision-timeline-get ...
node dist/bin/llmvision.js llmvision-get-image ...
node dist/bin/llmvision.js llmvision-analyze-image ...
node dist/bin/llmvision.js llmvision-create-event ...

# JSON output
node dist/bin/llmvision.js <command> [args...] --json
```

### CLI Environment Variables

| Variable | Description |
|----------|-------------|
| `LLMVISION_SERVER` | Home Assistant server URL |
| `LLMVISION_TOKEN` | Home Assistant long-lived access token |
