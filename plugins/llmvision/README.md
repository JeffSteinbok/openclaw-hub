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
  "server": "http://192.168.1.76:8123",
  "token": "your_long_lived_access_token"
}
```

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `server` | string | Yes | Home Assistant server URL |
| `token` | string | Yes | Home Assistant long-lived access token |

Uses the same Home Assistant credentials as the homeassistant plugin.

## Development

### Build

```bash
npm run build --workspace=plugins/llmvision
```
