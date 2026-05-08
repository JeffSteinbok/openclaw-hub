# Home Assistant

Use Home Assistant as the control plane for the house. This plugin lets the agent inspect entity state, trigger services, review recent activity, adjust speaker volume, and capture camera snapshots from one place.

## Tools

| Tool | Description |
|------|-------------|
| `hass_state_get` | Get the current state of a Home Assistant entity |
| `hass_state_list` | List Home Assistant entities, optionally filtered by domain |
| `hass_service_call` | Call a Home Assistant service |
| `hass_event_list` | List Home Assistant event types |
| `hass_person_find` | Find a person by name or entity ID |
| `hass_speaker_volume_get` | Get the volume level of one speaker or all speakers |
| `hass_speaker_volume_set` | Set the volume level of a speaker |
| `hass_camera_list` | List available Home Assistant cameras |
| `hass_camera_snapshot` | Take a snapshot from a Home Assistant camera |
| `hass_logbook` | Get Home Assistant logbook entries with optional filters |

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

Set credentials in `plugins.entries["homeassistant"].config`:

```json
{
  "plugins": {
    "entries": {
      "homeassistant": {
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

## Notes

- Primary interface for all home automation tasks.
- Covers lights, locks, alarm, cameras, scenes, and more.
- Camera names are hardcoded in `tools.py` — edit `CAMERAS` dict to match your setup.

## Development

### Build

```bash
npm run build --workspace=plugins/homeassistant
```

---

## CLI Usage

All tools are also available as a standalone CLI:

```bash
cd plugins/homeassistant
npm install && npm run build
node dist/bin/homeassistant.js --help
```

### Example commands

```bash
node dist/bin/homeassistant.js hass-state-get ...
node dist/bin/homeassistant.js hass-state-list ...
node dist/bin/homeassistant.js hass-service-call ...
node dist/bin/homeassistant.js hass-event-list ...
node dist/bin/homeassistant.js hass-person-find ...
node dist/bin/homeassistant.js hass-speaker-volume-get ...
node dist/bin/homeassistant.js hass-speaker-volume-set ...
node dist/bin/homeassistant.js hass-logbook ...
node dist/bin/homeassistant.js hass-camera-list ...
node dist/bin/homeassistant.js hass-camera-snapshot ...
node dist/bin/homeassistant.js hass-camera-collage ...

# JSON output
node dist/bin/homeassistant.js <command> [args...] --json
```

### CLI Environment Variables

| Variable | Description |
|----------|-------------|
| `HOMEASSISTANT_SERVER` | Home Assistant server URL (e.g. http://192.168.1.76:8123) |
| `HOMEASSISTANT_TOKEN` | Home Assistant long-lived access token |
