# Outlook Work Calendar

Read upcoming events from a published Outlook work calendar without going through a full Microsoft account flow. It is a lightweight option when you only need visibility into the published schedule.

## Tools

| Tool | Description |
|------|-------------|
| `outlook_work_calendar_fetch` | Fetch upcoming events from the published Outlook work calendar |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OUTLOOK_WORK_CALENDAR_URL` | Published Outlook work calendar URL |
| `OUTLOOK_WORK_FOLDER_ID` | EWS folder identifier for the published calendar |

## Notes

- No OAuth needed — uses a published calendar URL via the EWS JSON API.
- Returns UTC datetimes.

## Plugin Structure

```
openclaw.plugin.json
src/tools.py
src/fetch_calendar.py
```
