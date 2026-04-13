# Outlook Calendar

Read upcoming events from Outlook personal and family calendars. It is useful for agenda summaries, date checks, and scheduling flows that need one calendar or a merged view of both.

## Tools

| Tool | Description |
|------|-------------|
| `outlook_calendar_fetch` | Fetch upcoming events from personal and/or family Outlook calendars |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OUTLOOK_CLIENT_ID` | Microsoft Graph OAuth2 client ID |
| `OUTLOOK_CLIENT_SECRET` | Microsoft Graph OAuth2 client secret |
| `OUTLOOK_REFRESH_TOKEN` | OAuth2 refresh token for token renewal |

## Notes

- Uses OAuth2 consumer flow with inline token refresh.
- Returns UTC datetimes — convert with `datetime.astimezone()`.
- Family calendar is named "family v2" in Outlook.

## Plugin Structure

```
openclaw.plugin.json
src/tools.py
src/fetch_calendar.py
```
