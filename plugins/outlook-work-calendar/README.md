# Outlook Work Calendar

Read upcoming events from a published Outlook work calendar without going through a full Microsoft account flow. It is a lightweight option when you only need visibility into the published schedule.

## Tools

| Tool | Description |
|------|-------------|
| [`outlook_work_calendar_fetch`](#tool-outlook_work_calendar_fetch) | Fetch upcoming events from the published Outlook work calendar |

## Configuration Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Optional | Published Outlook work calendar base URL |
| `folderId` | string | Optional | EWS folder identifier for the published calendar |

## Example config

Set Outlook Work Calendar under `plugins.entries["outlook-work-calendar"].config`:

```json
{
  "plugins": {
    "entries": {
      "outlook-work-calendar": {
        "enabled": true,
        "config": {
          "url": "${OUTLOOK_WORK_CALENDAR_URL}",
          "folderId": "${OUTLOOK_WORK_FOLDER_ID}"
        }
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OUTLOOK_WORK_CALENDAR_URL` | No | Backing value for plugin config `url` |
| `OUTLOOK_WORK_FOLDER_ID` | No | Backing value for plugin config `folderId` |

## Tool Parameters

<a id="tool-outlook_work_calendar_fetch"></a>

### `outlook_work_calendar_fetch`

- `days` — optional number of days ahead to fetch (default `7`)

## Notes

- No OAuth needed — uses a published calendar URL via the EWS JSON API.
- Returns UTC datetimes from the published endpoint.

## Plugin Structure

```
openclaw.plugin.json
src/tools.py
src/fetch_calendar.py
```
