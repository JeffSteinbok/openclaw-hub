# ICS Calendar

Fetch upcoming events from published ICS calendar feeds, including personal, family, or travel calendars. Configure named calendars once in `openclaw.json`, then fetch them by stable `calendar_id` values instead of passing environment-variable names through tool calls.

## Tools

| Tool | Description |
|------|-------------|
| [`ics_calendar_fetch`](#tool-ics_calendar_fetch) | Fetch upcoming events from a configured ICS calendar feed |

## Configuration Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `calendars` | array<object> | Optional | Configured ICS feeds available by id |
| `calendars[].id` | string | Required | Stable calendar identifier used by tool calls |
| `calendars[].label` | string | Optional | Friendly display name used in output |
| `calendars[].url` | string | Required | Published ICS feed URL |
| `access` | object | Optional | Per-calendar read access by agent and verified sender (see [Access control](#access-control)) |

## Example config

Set calendars in `plugins.entries["ics-calendar"].config`:

```json
{
  "plugins": {
    "entries": {
      "ics-calendar": {
        "enabled": true,
        "config": {
          "calendars": [
            {
              "id": "personal",
              "label": "Personal",
              "url": "${CALENDAR_PERSONAL_ICS_URL}"
            },
            {
              "id": "family",
              "label": "Family",
              "url": "${CALENDAR_FAMILY_ICS_URL}"
            },
            {
              "id": "travel",
              "label": "Travel",
              "url": "${CALENDAR_TRAVEL_ICS_URL}"
            }
          ]
        }
      }
    }
  }
}
```

Use `${...}` interpolation if you want the actual feed URLs to come from `.env`.

## Access control

Add `access.calendars` to restrict which agents and verified senders may read
each configured calendar. The keys are the `calendars[].id` values. The
pseudo-id `_url` governs fetches by ad-hoc `url`, and when `url` is passed it
is the only thing checked, even if `calendar_id` is also given. Grants and
matching come from
[carapace-plugin-sdk](https://github.com/JeffSteinbok/carapace-plugin-sdk#call-context-and-access-control-v31):

- **A grant** is `"*"` or `{ "agent": ..., "sender": ... }`. Every field in a grant must match, and any one matching grant allows the call.
- **`sender`** names an OpenClaw root-config `accessGroups` entry (`type: "message.senders"`), or the special name `"owner"`.
- **Turns with no sender** (cron, CLI) match only grants with no `sender` field.
- **No `access` block** allows everything, the same as before.
- **Default-deny** applies once `access.calendars` exists. An unlisted id, including `_url`, is denied.

```json
{
  "accessGroups": {
    "alex": { "type": "message.senders", "members": { "imessage": ["+14255550199"] } }
  },
  "plugins": {
    "entries": {
      "ics-calendar": {
        "config": {
          "calendars": [
            { "id": "family", "label": "Family", "url": "${CALENDAR_FAMILY_ICS_URL}" },
            { "id": "alex", "label": "Alex", "url": "${CALENDAR_ALEX_ICS_URL}" }
          ],
          "access": {
            "calendars": {
              "family": { "read": ["*"] },
              "alex":   { "read": [{ "agent": "main" }, { "sender": "alex" }] },
              "_url":   { "read": [{ "agent": "main" }] }
            }
          }
        }
      }
    }
  }
}
```

A denied call returns a tool error, for example
`Access denied: agent "family" (no sender) may not read calendar "alex"`, and
nothing is fetched. The standalone CLI has no `access` block, so it is not
restricted.

## Tool Parameters

<a id="tool-ics_calendar_fetch"></a>

### `ics_calendar_fetch`

- `calendar_id` — configured calendar id to fetch
- `days` — number of days ahead to fetch (default `7`)
- `url` — optional one-off direct ICS URL override
- `label` — optional display label when using `url`

## Notes

- Uses published ICS feed URLs from plugin config.
- The preferred path is `calendar_id`; `url` is only for ad hoc fetches.
- Results are parsed from iCalendar format.

## Plugin Structure

```
openclaw.plugin.json
src/tools.py
src/fetch_calendar.py
```

---

## CLI Usage

Built with [Carapace Plugin SDK](https://github.com/JeffSteinbok/carapace-plugin-sdk).

All tools are also available as a standalone CLI:

```bash
cd plugins/ics-calendar
npm install && npm run build
node dist/bin/ics-calendar.js --help
```

### Example commands

```bash
node dist/bin/ics-calendar.js ics-calendar-fetch ...

# JSON output
node dist/bin/ics-calendar.js <command> [args...] --json
```

### CLI Environment Variables

| Variable | Description |
|----------|-------------|
| `ICS_CALENDAR_CALENDARS` | List of calendar configs with id, label, url |
