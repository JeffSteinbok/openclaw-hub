# Home Assistant – LLM Vision

Home Assistant LLM Vision integration for Octo. This plugin exposes Python-backed tools that query the LLM Vision timeline, download timeline keyframes, trigger new image analysis runs, and create timeline events through the Home Assistant REST API.

## Tools

| Tool | Description |
|------|-------------|
| `llmvision_timeline_get` | List timeline events from the LLM Vision timeline API |
| `llmvision_get_image` | Download a timeline keyframe image from Home Assistant media storage |
| `llmvision_analyze_image` | Trigger a fresh AI image analysis run for a camera entity |
| `llmvision_create_event` | Create a new event in the LLM Vision timeline |

## Configuration

This plugin reads Home Assistant connection settings from environment variables:

- `HASS_SERVER` — base URL for the Home Assistant instance
- `HASS_TOKEN` — bearer token used for Home Assistant API requests

## Structure

```text
plugins/llmvision/
  openclaw.plugin.json
  src/index.ts
  src/tools.py
```

`src/index.ts` registers the plugin with the TypeScript framework, while `src/tools.py` contains the Python tool implementations that talk directly to the Home Assistant REST API.
