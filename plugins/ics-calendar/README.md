# ICS Calendar

Fetch upcoming events from published ICS calendar feeds, including personal, family, or travel calendars. Configure named calendars once in `openclaw.json`, then fetch them by stable `calendar_id` values instead of passing environment-variable names through tool calls.

## Tools

| Tool | Description |
|------|-------------|
| `ics_calendar_fetch` | Fetch upcoming events from a configured ICS calendar feed |

## Configuration Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `calendars` | array<object> | Optional | Configured ICS feeds available by id |
| `calendars[].id` | string | Required | Stable calendar identifier used by tool calls |
| `calendars[].label` | string | Optional | Friendly display name used in output |
| `calendars[].url` | string | Required | Published ICS feed URL |

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

## Tool Parameters

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
