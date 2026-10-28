# ✉️ FastMail tools

Send email and manage calendar events in Fastmail via JMAP and CalDAV.

> **Source:** [openclaw-hub](https://github.com/JeffSteinbok/openclaw-hub/tree/main/plugins/fastmail)

## Tools

| Tool | Description |
|------|-------------|
| [`fastmail_send`](#tool-fastmail_send) | Send a plain-text or HTML email, with optional attachments, threading and custom headers |
| [`fastmail_search`](#tool-fastmail_search) | Search emails by keyword, sender, subject, or date range |
| [`fastmail_read`](#tool-fastmail_read) | Read a specific email by JMAP ID |
| [`fastmail_inbox`](#tool-fastmail_inbox) | Show recent inbox emails, optionally filtered to unread |
| [`fastmail_meeting`](#tool-fastmail_meeting) | Create a calendar meeting invite via CalDAV with iMIP invitations |
| [`fastmail_update_event`](#tool-fastmail_update_event) | Update a calendar event's title, time, location, attendees, or status |
| [`fastmail_delete_event`](#tool-fastmail_delete_event) | Delete a calendar event; Fastmail emails cancellations to attendees |
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
| `to` | string or array | Yes | Recipient address(es) |
| `subject` | string | Yes | Email subject line |
| `body` | string | Yes | Plain-text email body |
| `html_body` | string | No | HTML body; the message is sent as multipart/alternative with both parts |
| `cc` | array | No | CC recipients |
| `signature` | string | No | Signature appended after the body |
| `attachment` | array | No | File paths to attach |
| `in_reply_to` | string | No | Message-ID being replied to, with angle brackets, for threading |
| `references` | string | No | Space-separated Message-IDs for the `References` header |
| `headers` | object | No | Extra headers as `{ "Name": "value" }`, up to 20 (see below) |

**Custom headers.** `headers` sets extra headers such as `Reply-To` or your own `X-` headers:

```json
{ "headers": { "Reply-To": "owner@example.com", "X-Octo-Source": "usps-digest" } }
```

- Names must be valid header names (printable ASCII, no spaces or colons), each set at most once.
- Values can't contain line breaks, so a value can't add more headers. Non-ASCII values are RFC 2047 encoded, except in address headers (`Reply-To`, `Resent-*`), which must be plain ASCII.
- Headers the tool sets itself or that route and authenticate mail are refused: `From`, `To`, `Cc`, `Bcc`, `Subject`, `Date`, `Message-ID`, `In-Reply-To`, `References`, `MIME-Version`, any `Content-*`, `Sender`, `Return-Path`, `Received`, `DKIM-Signature`, `ARC-*`, `Authentication-Results`, `Received-SPF`. Use the tool's own parameters for addressing, subject and threading.
- A refused header fails the whole send before anything is sent.
- Plain sends set them through JMAP (`header:<Name>:asRaw`); sends with attachments write them into the MIME message.

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
| `end` | string | No | End datetime (ISO). Overrides `duration` |
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

<a id="tool-fastmail_delete_event"></a>

### `fastmail_delete_event`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `uid` | string | No | Event UID to delete |
| `find` | string | No | Text search to find the event |
| `force` | boolean | No | Delete all matching events when multiple found |

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

Built with [Carapace Plugin SDK](https://github.com/JeffSteinbok/carapace-plugin-sdk).

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
