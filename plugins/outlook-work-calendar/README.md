# Outlook Work Calendar

Read upcoming events from a published Outlook work calendar without going through a full Microsoft account flow. It is a lightweight option when you only need visibility into the published schedule.

## Tools

| Tool | Description |
|------|-------------|
| [`outlook_work_calendar_fetch`](#tool-outlook_work_calendar_fetch) | Fetch upcoming events from the published Outlook work calendar |

The model sees one line per event, in local time (`2026-05-03 10:00–10:30 1:1 with Manager @ Teams`, with free/tentative noted); code and scripts still get the full events ([SDK compact view](https://github.com/JeffSteinbok/carapace-plugin-sdk#compact-results-for-the-model-v32)).

## Configuration Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Optional | Published Outlook work calendar base URL |
| `folderId` | string | Optional | EWS folder identifier for the published calendar |
| `access` | object | Optional | Read access by agent and verified sender for the calendar id `work` (see [Access control](#access-control)) |

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

## Access control

This plugin serves one calendar, with the ACL id `work`. Add
`access.calendars.work` to choose which agents and verified senders may read
it:

```json
{
  "accessGroups": {
    "alex": { "type": "message.senders", "members": { "imessage": ["+14255550199"], "discord": ["123456789012345678"] } }
  },
  "plugins": {
    "entries": {
      "outlook-work-calendar": {
        "config": {
          "access": {
            "calendars": {
              "work": { "read": [{ "agent": "main" }, { "sender": "alex" }] }
            }
          }
        }
      }
    }
  }
}
```

Grant semantics come from
[carapace-plugin-sdk](https://github.com/JeffSteinbok/carapace-plugin-sdk#call-context-and-access-control-v31):

- **A grant** is `"*"` or `{ "agent": ..., "sender": ... }`. Every field in a grant must match, and any one matching grant allows the call.
- **`sender`** names an OpenClaw root-config `accessGroups` entry, or `"owner"`.
- **Turns with no sender** (cron, CLI) match only grants with no `sender` field.
- **No `access` block** allows everything.
- **An ACL without `work`** denies it.

A denied call returns
`Access denied: agent "family" (no sender) may not read calendar "work"`
without calling EWS.

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

---

## CLI Usage

Built with [Carapace Plugin SDK](https://github.com/JeffSteinbok/carapace-plugin-sdk).

All tools are also available as a standalone CLI:

```bash
cd plugins/outlook-work-calendar
npm install && npm run build
node dist/bin/outlook-work-calendar.js --help
```

### Example commands

```bash
node dist/bin/outlook-work-calendar.js outlook-work-calendar-fetch ...

# JSON output
node dist/bin/outlook-work-calendar.js <command> [args...] --json
```

### CLI Environment Variables

| Variable | Description |
|----------|-------------|
| `OUTLOOK_WORK_CALENDAR_CALENDAR_URL` | Published Outlook work calendar base URL |
| `OUTLOOK_WORK_CALENDAR_FOLDER_ID` | EWS folder ID for the calendar |
