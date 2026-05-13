# Outlook Calendar

Read upcoming events from Outlook personal and family calendars. It is useful for agenda summaries, date checks, and scheduling flows that need one calendar or a merged view of both.

## Tools

| Tool | Description |
|------|-------------|
| [`outlook_calendar_fetch`](#tool-outlook_calendar_fetch) | Fetch upcoming events from personal, family, or combined Outlook calendars |

## Configuration Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `clientId` | string | Optional | Microsoft Graph OAuth2 client ID |
| `clientSecret` | string | Optional | Microsoft Graph OAuth2 client secret |
| `refreshToken` | string | Optional | Microsoft Graph OAuth2 refresh token |
| `personalCalendarNames` | array<string> | Optional | Extra personal calendar names to try before the built-in defaults |
| `familyCalendarNames` | array<string> | Optional | Extra family calendar names to try before the built-in defaults |

## Example config

Set Outlook Calendar under `plugins.entries["outlook-calendar"].config`:

```json
{
  "plugins": {
    "entries": {
      "outlook-calendar": {
        "enabled": true,
        "config": {
          "clientId": "${OUTLOOK_CLIENT_ID}",
          "clientSecret": "${OUTLOOK_CLIENT_SECRET}",
          "refreshToken": "${OUTLOOK_REFRESH_TOKEN}",
          "personalCalendarNames": ["calendar", "personal"],
          "familyCalendarNames": ["family v2", "family"]
        }
      }
    }
  }
}
```

The calendar-name arrays are optional overrides. If omitted, the plugin uses its built-in personal/family defaults.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OUTLOOK_CLIENT_ID` | No | Backing value for plugin config `clientId` |
| `OUTLOOK_CLIENT_SECRET` | No | Backing value for plugin config `clientSecret` |
| `OUTLOOK_REFRESH_TOKEN` | No | Backing value for plugin config `refreshToken` |
| `OUTLOOK_PERSONAL_CALENDAR_NAMES` | No | Backing value for plugin config `personalCalendarNames` as a comma-separated list |
| `OUTLOOK_FAMILY_CALENDAR_NAMES` | No | Backing value for plugin config `familyCalendarNames` as a comma-separated list |

## Tool Parameters

<a id="tool-outlook_calendar_fetch"></a>

### `outlook_calendar_fetch`

- `calendar` — optional target calendar: `personal`, `family`, or `all` (default `all`)
- `days` — optional number of days ahead to fetch (default `7`)

## Notes

- Uses OAuth2 consumer flow with inline token refresh.
- Returns UTC datetimes and converts them to local time when Graph marks them as UTC.
- The extra calendar-name config fields are only for override cases; most setups can rely on the built-in defaults.

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
cd plugins/outlook-calendar
npm install && npm run build
node dist/bin/outlook-calendar.js --help
```

### Example commands

```bash
node dist/bin/outlook-calendar.js outlook-calendar-fetch ...

# JSON output
node dist/bin/outlook-calendar.js <command> [args...] --json
```

### CLI Environment Variables

| Variable | Description |
|----------|-------------|
| `OUTLOOK_CALENDAR_CLIENT_ID` | Microsoft OAuth client ID |
| `OUTLOOK_CALENDAR_CLIENT_SECRET` | Microsoft OAuth client secret |
| `OUTLOOK_CALENDAR_REFRESH_TOKEN` | Microsoft OAuth refresh token |
