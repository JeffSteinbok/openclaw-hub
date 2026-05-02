# ICS Calendar

Fetch upcoming events from published ICS calendar feeds, including personal, family, or travel calendars. Configure named calendars once in `openclaw.json`, then fetch them by stable `calendar_id` values instead of passing environment-variable names through tool calls.

## Tools

| Tool | Description |
|------|-------------|
| `ics_calendar_fetch` | Fetch upcoming events from a configured ICS calendar feed |

## Configuration

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
              "id": "nicole",
              "label": "Nicole",
              "url": "${CALENDAR_NICOLE_ICS_URL}"
            },
            {
              "id": "family",
              "label": "Family",
              "url": "${CALENDAR_FAMILY_ICS_URL}"
            },
            {
              "id": "tripit",
              "label": "TripIt",
              "url": "${CALENDAR_TRIPIT_ICS_URL}"
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
