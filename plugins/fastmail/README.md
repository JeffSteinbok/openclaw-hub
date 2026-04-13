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

## Environment Variables

| Variable | Description |
|----------|-------------|
| `FASTMAIL_ACCOUNT_ID` | JMAP account identifier |
| `FASTMAIL_JMAP_TOKEN` | JMAP API authentication token |
| `FASTMAIL_FROM_EMAIL` | Sender email address (required) |
| `FASTMAIL_FROM_NAME` | Sender display name (default: "OpenClaw Assistant") |
| `FASTMAIL_IDENTITY_ID` | JMAP identity ID for sending |
| `FASTMAIL_DRAFTS_ID` | JMAP mailbox ID for drafts |
| `FASTMAIL_SENT_ID` | JMAP mailbox ID for sent mail |
| `FASTMAIL_CALDAV_URL` | CalDAV server URL |
| `FASTMAIL_CALDAV_USERNAME` | CalDAV username |
| `FASTMAIL_CALDAV_PASSWORD` | CalDAV password |
| `FASTMAIL_CALDAV_CALENDAR_PATH` | CalDAV calendar path |

## Notes

- Uses JMAP for email operations and CalDAV for calendar.
- CalDAV server handles iMIP invite delivery automatically — no manual MIME sending needed.
- `fastmail_meeting` always adds the configured sender as an attendee.
- Sends email from the configured `FASTMAIL_FROM_EMAIL`.

## Plugin Structure

```
openclaw.plugin.json
src/tools.py
src/fastmail.py
src/fastmail_search.py
src/caldav_client.py
tests/
```
