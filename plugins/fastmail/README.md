# ✉️ FastMail tools

Send email and manage calendar events in Fastmail via JMAP and CalDAV.

> **Source:** [openclaw-hub](https://github.com/JeffSteinbok/openclaw-hub/tree/main/plugins/fastmail)

## Tools

| Tool | Description |
|------|-------------|
| [`fastmail_send`](#tool-fastmail_send) | Send a plain-text email with optional attachments |
| [`fastmail_search`](#tool-fastmail_search) | Search emails by keyword, sender, subject, or date range |
| [`fastmail_read`](#tool-fastmail_read) | Read a specific email by JMAP ID |
| [`fastmail_inbox`](#tool-fastmail_inbox) | Show recent inbox emails, optionally filtered to unread |
| [`fastmail_meeting`](#tool-fastmail_meeting) | Create a calendar meeting invite via CalDAV with iMIP invitations |
| [`fastmail_update_event`](#tool-fastmail_update_event) | Update a calendar event's title, time, location, attendees, or status |
| [`fastmail_query_events`](#tool-fastmail_query_events) | Query calendar events by date range, text, attendee, or UID |

## Configuration Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `accountId` | string | Yes | JMAP account identifier |
| `jmapToken` | string | Yes | JMAP API authentication token |
| `fromEmail` | string | Yes | Sender email address |
| `fromName` | string | Yes | Sender display name |
| `identityId` | string | Yes | JMAP identity ID for sending |
| `draftsId` | string | Yes | JMAP mailbox ID for drafts |
| `sentId` | string | Yes | JMAP mailbox ID for sent mail |
| `caldavUrl` | string | Yes | CalDAV server URL |
| `caldavUsername` | string | Yes | CalDAV username |
| `caldavPassword` | string | Yes | CalDAV password |
| `caldavCalendarPath` | string | Yes | CalDAV calendar path |

## Example config

```json
{
  "plugins": {
    "entries": {
      "fastmail": {
        "enabled": true,
        "config": {
          "accountId": "u12345678",
          "jmapToken": "fmu1-your-token-here",
          "fromEmail": "user@fastmail.com",
          "fromName": "Your Name",
          "identityId": "id-1234",
          "draftsId": "mailbox-drafts-id",
          "sentId": "mailbox-sent-id",
          "caldavUrl": "https://caldav.fastmail.com/dav",
          "caldavUsername": "user@fastmail.com",
          "caldavPassword": "app-password-here",
          "caldavCalendarPath": "/dav/calendars/user/default/"
        }
      }
    }
  }
}
```

## Tool Parameters

<a id="tool-fastmail_send"></a>

### `fastmail_send`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `to` | string | Yes | Recipient email address |
| `subject` | string | Yes | Email subject line |
| `body` | string | Yes | Plain-text email body |
| `cc` | array | No | CC recipients |
| `signature` | string | No | Signature to append |
| `attachment` | array | No | File paths to attach |

<a id="tool-fastmail_search"></a>

### `fastmail_search`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | No | Search keyword |
| `from` | string | No | Filter by sender |
| `to` | string | No | Filter by recipient |
| `subject` | string | No | Filter by subject |
| `since` | string | No | After date (ISO 8601) |
| `before` | string | No | Before date (ISO 8601) |
| `limit` | number | No | Max results to return |
| `account_id` | string | No | Override account ID |

<a id="tool-fastmail_read"></a>

### `fastmail_read`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | JMAP email ID |
| `account_id` | string | No | Override account ID |

<a id="tool-fastmail_inbox"></a>

### `fastmail_inbox`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | No | Max emails to return |
| `unread` | boolean | No | Filter to unread only |
| `account_id` | string | No | Override account ID |

<a id="tool-fastmail_meeting"></a>

### `fastmail_meeting`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `to` | string | Yes | Primary attendee email |
| `subject` | string | Yes | Meeting title |
| `start` | string | Yes | Start time (ISO 8601) |
| `cc` | array | No | Additional attendees |
| `duration` | string | No | Duration (e.g. "1h", "30m") |
| `location` | string | No | Meeting location |
| `description` | string | No | Meeting description |
| `timezone` | string | No | Timezone (default: America/Los_Angeles) |
| `signature` | string | No | Signature for invite email |

<a id="tool-fastmail_update_event"></a>

### `fastmail_update_event`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `uid` | string | No | Event UID to update |
| `find` | string | No | Text search to find the event |
| `new_title` | string | No | New event title |
| `new_start` | string | No | New start time |
| `new_duration` | string | No | New duration |
| `new_location` | string | No | New location |
| `new_description` | string | No | New description |
| `timezone` | string | No | Timezone |
| `status` | string | No | Event status (CONFIRMED, CANCELLED, TENTATIVE) |
| `add_attendee` | array | No | Attendees to add |
| `remove_attendee` | array | No | Attendees to remove |
| `force` | boolean | No | Force update without confirmation |

<a id="tool-fastmail_query_events"></a>

### `fastmail_query_events`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `after` | string | No | Events after this date |
| `before` | string | No | Events before this date |
| `text` | string | No | Text search |
| `attendee` | string | No | Filter by attendee email |
| `uid` | string | No | Filter by event UID |

---

## CLI Usage

All tools are also available as a standalone CLI:

```bash
cd plugins/fastmail
npm install && npm run build
node dist/bin/fastmail.js --help
```

### Example commands

```bash
node dist/bin/fastmail.js fastmail-inbox --limit 5
node dist/bin/fastmail.js fastmail-search --query "invoice"
node dist/bin/fastmail.js fastmail-read <email-id>
node dist/bin/fastmail.js fastmail-send --to user@example.com --subject "Hello" --body "Hi there"
node dist/bin/fastmail.js fastmail-query-events --after 2026-05-01 --before 2026-05-31

# JSON output
node dist/bin/fastmail.js <command> [args...] --json
```

### CLI Environment Variables

| Variable | Description |
|----------|-------------|
| `FASTMAIL_ACCOUNT_ID` | JMAP account identifier |
| `FASTMAIL_JMAP_TOKEN` | JMAP API authentication token |
| `FASTMAIL_FROM_EMAIL` | Sender email address |
| `FASTMAIL_FROM_NAME` | Sender display name |
| `FASTMAIL_IDENTITY_ID` | JMAP identity ID for sending |
| `FASTMAIL_DRAFTS_ID` | JMAP mailbox ID for drafts |
| `FASTMAIL_SENT_ID` | JMAP mailbox ID for sent mail |
| `FASTMAIL_CALDAV_URL` | CalDAV server URL |
| `FASTMAIL_CALDAV_USERNAME` | CalDAV username |
| `FASTMAIL_CALDAV_PASSWORD` | CalDAV password |
| `FASTMAIL_CALDAV_CALENDAR_PATH` | CalDAV calendar path |
