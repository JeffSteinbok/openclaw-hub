# Home Assistant

Use Home Assistant as the control plane for the house. This plugin lets the agent inspect entity state, trigger services, review recent activity, adjust speaker volume, and capture camera snapshots from one place.

## Tools

| Tool | Description |
|------|-------------|
| `hass_state_get` | Get the current state of a Home Assistant entity |
| `hass_state_list` | Find entities by domain (one or comma-separated) and/or name search; with neither, returns per-domain counts only |
| `hass_service_call` | Call a Home Assistant service; when the reply lists no change, re-reads the entities and warns only if they did not update |
| `hass_notify` | Send a phone notification, but only to a target listed in `notifyTargets` (safe for restricted agents) |
| `hass_lovelace_get` | Read a Lovelace dashboard config or a single view |
| `hass_lovelace_set` | Write a Lovelace dashboard config |
| `hass_automation_list` | List automations with config id, alias, and state |
| `hass_automation_get` | Read an automation's config (admin token) |
| `hass_automation_set` | Create or replace an automation's config (admin token) |
| `hass_script_list` | List scripts with id, alias, and state |
| `hass_script_get` | Read a script's config (admin token) |
| `hass_script_set` | Create or replace a script's config (admin token) |
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
  "server": "http://homeassistant.local:8123",
  "token": "your_long_lived_access_token",
  "notifyTargets": {
    "alex": { "service": "mobile_app_alex_iphone", "description": "Alex's iPhone" },
    "family": { "service": "family_phones" }
  }
}
```

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `server` | string | Yes | Home Assistant server URL |
| `token` | string | Yes | Home Assistant long-lived access token |
| `notifyTargets` | object | No | Targets `hass_notify` may send to. Keys are the names the agent uses; `service` is the part after `notify.` (a `mobile_app_*` service or a notify group); `description` is optional. With none, `hass_notify` refuses. |
| `notifyUrlSchemes` | string[] | No | URL schemes `hass_notify` accepts for its tap-to-open `url`. Default `["hassonic"]`. |

## Notifications for restricted agents

`hass_notify` calls `POST /api/services/notify/<service>` for one of the configured `notifyTargets` and nothing else. The agent picks a target by name; it can't pass a service name or `entity_id`.

| Param | Required | Notes |
|-------|----------|-------|
| `target` | Yes | Exact key of `notifyTargets`; anything else is rejected without calling Home Assistant. |
| `message` | Yes | Notification body, up to 1000 characters. |
| `title` | No | Up to 100 characters. |
| `url` | No | Opened when the notification is tapped; sent as `data.url`. Only `notifyUrlSchemes` (default `hassonic://`) are accepted. |
| `interruptionLevel` | No | `passive`, `active`, or `time-sensitive`; sent as `data.push["interruption-level"]`. `critical` is not allowed. |

It returns `{ "ok": true, "target": "alex" }` or an `error`. Errors never include the token or server address.

`hass_service_call` can call any service (unlock doors, disarm the alarm), so a family-facing agent should get `hass_notify` and be denied the general tools:

```json5
agents: {
  list: [
    {
      id: "family",
      tools: {
        allow: ["hass_notify", /* … */],
        deny: ["hass_service_call", "hass_lovelace_set"],
      },
    },
  ],
}
```

`notifyTargets` is gateway-wide: every agent allowed `hass_notify` can reach every listed target.

## Example config

Set credentials in `plugins.entries["homeassistant"].config`:

```json
{
  "plugins": {
    "entries": {
      "homeassistant": {
        "enabled": true,
        "config": {
          "server": "http://homeassistant.local:8123",
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
- `hass_state_list` shows the model one line per entity (`entity_id "Name": state (brightness, temperatures, media…)`) instead of full JSON; code and scripts still get the full entities ([SDK compact view](https://github.com/JeffSteinbok/carapace-plugin-sdk#compact-results-for-the-model-v32)).

## Development

### Build

```bash
npm run build --workspace=plugins/homeassistant
```

---

## CLI Usage

Built with [Carapace Plugin SDK](https://github.com/JeffSteinbok/carapace-plugin-sdk).

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
node dist/bin/homeassistant.js hass-notify --target alex --message "Dinner is ready"
node dist/bin/homeassistant.js hass-lovelace-get ...
node dist/bin/homeassistant.js hass-lovelace-set ...
node dist/bin/homeassistant.js hass-automation-list ...
node dist/bin/homeassistant.js hass-automation-get ...
node dist/bin/homeassistant.js hass-automation-set ...
node dist/bin/homeassistant.js hass-script-list ...
node dist/bin/homeassistant.js hass-script-get ...
node dist/bin/homeassistant.js hass-script-set ...
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
| `HOMEASSISTANT_SERVER` | Home Assistant server URL (e.g. http://<home-assistant-host>:8123) |
| `HOMEASSISTANT_TOKEN` | Home Assistant long-lived access token |
| `HOMEASSISTANT_NOTIFY_TARGETS` | `notifyTargets` as JSON, e.g. `{"alex":{"service":"mobile_app_alex_iphone"}}` |
| `HOMEASSISTANT_NOTIFY_URL_SCHEMES` | Comma-separated URL schemes for `hass-notify --url` (default `hassonic`) |
