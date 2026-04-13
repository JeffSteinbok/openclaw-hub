# ICS Calendar

Fetch upcoming events from any published ICS calendar feed, including personal, family, or travel calendars. You can point the tool at a URL directly or reference an environment variable that stores the feed URL.

## Tools

| Tool | Description |
|------|-------------|
| `ics_calendar_fetch` | Fetch upcoming events from Nicole's ICS calendar feed |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CALENDAR_NICOLE_ICS_URL` | Outlook Live published ICS feed URL (read at runtime) |

## Notes

- Uses an Outlook Live published ICS feed URL.
- Results are parsed from iCalendar format.

## Plugin Structure

```
openclaw.plugin.json
src/tools.py
src/fetch_calendar.py
```
