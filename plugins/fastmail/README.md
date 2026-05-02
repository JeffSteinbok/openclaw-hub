# Fastmail

Use Fastmail for outbound email, inbox lookups, and calendar automation from OpenClaw. It covers day-to-day tasks like sending messages, triaging mail, creating meetings, and updating existing events without leaving the agent flow.

## Tools

| Tool | Description |
|------|-------------|
| `fastmail_send` | Send a plain-text email via JMAP, with optional file attachments |
| `fastmail_search` | Search emails by keyword, sender, subject, or date range |
| `fastmail_read` | Read a specific email by its JMAP email ID |
| `fastmail_inbox` | Show recent inbox emails, optionally filtered to unread |
| `fastmail_meeting` | Create a calendar meeting invite via CalDAV with iMIP invitations |
| `fastmail_update_event` | Find and update a calendar event by UID or text search |
| `fastmail_query_events` | Query calendar events by date range, text, attendee, or UID |

## Configuration Schema

```json
{
  "accountId": "u12345678",
  "jmapToken": "fmu1-...",
  "fromEmail": "you@fastmail.com",
  "fromName": "OpenClaw Assistant",
  "identityId": "id-...",
  "draftsId": "mb-...",
  "sentId": "mb-...",
  "caldavUrl": "https://caldav.fastmail.com/dav/calendars",
  "caldavUsername": "you@fastmail.com",
  "caldavPassword": "app-password",
  "caldavCalendarPath": "/dav/calendars/user/you@fastmail.com/Default/"
}
```

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `accountId` | string | Yes | JMAP account identifier |
| `jmapToken` | string | Yes | JMAP API authentication token |
| `fromEmail` | string | Yes | Sender email address |
| `fromName` | string | No | Sender display name (default: "OpenClaw Assistant") |
| `identityId` | string | Yes | JMAP identity ID for email submission |
| `draftsId` | string | Yes | JMAP mailbox ID for drafts |
| `sentId` | string | Yes | JMAP mailbox ID for sent mail |
| `caldavUrl` | string | No | CalDAV server URL (required for calendar tools) |
| `caldavUsername` | string | No | CalDAV username (required for calendar tools) |
| `caldavPassword` | string | No | CalDAV password / app password (required for calendar tools) |
| `caldavCalendarPath` | string | No | CalDAV calendar collection path |

## Notes

- Uses JMAP for email operations and CalDAV for calendar.
- CalDAV server handles iMIP invite delivery automatically — no manual MIME sending needed.
- `fastmail_meeting` always adds the configured sender as an attendee.
- Calendar tools (`fastmail_meeting`, `fastmail_update_event`, `fastmail_query_events`) require the CalDAV keys to be configured.

## Development

### Build

```bash
npm run build --workspace=plugins/fastmail
```
