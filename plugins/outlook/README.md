# Outlook

Unified mail and calendar tools for Outlook via Microsoft Graph. Replaces the former `outlook-mail` and `outlook-calendar` plugins.

## Tools

### Mail

| Tool | Description |
|------|-------------|
| [`outlook_inbox`](#tool-outlook_inbox) | List recent messages from the Outlook inbox or another mail folder |
| [`outlook_search`](#tool-outlook_search) | Search messages by query text, sender, subject, or date range |
| [`outlook_read`](#tool-outlook_read) | Read a specific message by ID, including full body content |
| [`outlook_save_attachments`](#tool-outlook_save_attachments) | Save matching attachments from a message to a local directory |
| [`outlook_send`](#tool-outlook_send) | Send a plain-text email with optional attachments and reply threading |
| [`outlook_reply`](#tool-outlook_reply) | Reply to a message with proper threading |
| [`outlook_forward`](#tool-outlook_forward) | Forward a message to new recipients |
| [`outlook_move`](#tool-outlook_move) | Move a message to a different folder |
| [`outlook_flag`](#tool-outlook_flag) | Flag, complete, or unflag a message |

### Calendar

| Tool | Description |
|------|-------------|
| [`outlook_calendar_fetch`](#tool-outlook_calendar_fetch) | Fetch upcoming events from personal, family, or combined calendars |
| [`outlook_create_event`](#tool-outlook_create_event) | Create a new event on a personal or family calendar |
| [`outlook_update_event`](#tool-outlook_update_event) | Update an existing event by ID |
| [`outlook_delete_event`](#tool-outlook_delete_event) | Delete a calendar event by ID |
| [`outlook_meeting`](#tool-outlook_meeting) | Create a meeting invite and send to attendees |
| [`outlook_query_events`](#tool-outlook_query_events) | Query events by date range, text, attendee, or iCalUId |

## Configuration

Set under `plugins.entries["outlook"].config`:

```json
{
  "plugins": {
    "entries": {
      "outlook": {
        "enabled": true,
        "config": {
          "clientId": "${OUTLOOK_CLIENT_ID}",
          "clientSecret": "${OUTLOOK_CLIENT_SECRET}",
          "refreshToken": "${OUTLOOK_REFRESH_TOKEN}"
        }
      }
    }
  }
}
```

### Config Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `clientId` | string | Optional | Microsoft Graph OAuth2 client ID |
| `clientSecret` | string | Optional | Microsoft Graph OAuth2 client secret |
| `refreshToken` | string | Optional | Microsoft Graph OAuth2 refresh token |
| `personalCalendarNames` | string[] | Optional | Additional names to match for personal calendar |
| `familyCalendarNames` | string[] | Optional | Additional names to match for family calendar |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OUTLOOK_CLIENT_ID` | Microsoft OAuth client ID |
| `OUTLOOK_CLIENT_SECRET` | Microsoft OAuth client secret |
| `OUTLOOK_REFRESH_TOKEN` | Microsoft OAuth refresh token |
| `OUTLOOK_PERSONAL_CALENDAR_NAMES` | Comma-separated additional personal calendar names |
| `OUTLOOK_FAMILY_CALENDAR_NAMES` | Comma-separated additional family calendar names |

## Tool Parameters

<a id="tool-outlook_inbox"></a>

### `outlook_inbox`

- `folder` — optional folder name (default: `inbox`). Well-known names: `inbox`, `junkemail`, `deleteditems`, `sentitems`, `drafts`, `outbox`, `archive`
- `limit` — optional max messages to return (default: `10`)
- `unread` — optional flag to show only unread messages

<a id="tool-outlook_search"></a>

### `outlook_search`

- `query` — full-text search across subject and body
- `from` — filter by sender email
- `subject` — subject substring filter
- `since` — start date `YYYY-MM-DD`
- `before` — end date `YYYY-MM-DD`
- `limit` — max results (default: `10`)

<a id="tool-outlook_read"></a>

### `outlook_read`

- `message_id` — Microsoft Graph message ID

<a id="tool-outlook_save_attachments"></a>

### `outlook_save_attachments`

- `message_id` — Microsoft Graph message ID
- `output_dir` — local directory to save attachments into
- `content_types` — optional content-type filters (default: `['image/*']`)

<a id="tool-outlook_send"></a>

### `outlook_send`

- `to` — recipient email address(es)
- `subject` — email subject
- `body` — plain-text body
- `cc` — optional CC recipients
- `attachment` — optional file path(s) to attach
- `in_reply_to` — Message-ID for threading (include angle brackets)
- `references` — space-separated Message-IDs for full thread References header
- `signature` — optional signature block

<a id="tool-outlook_reply"></a>

### `outlook_reply`

- `message_id` — Graph message ID to reply to
- `body` — reply body
- `reply_all` — reply to all recipients (default: `false`)
- `signature` — optional signature block

<a id="tool-outlook_forward"></a>

### `outlook_forward`

- `message_id` — Graph message ID to forward
- `to` — recipient(s) to forward to
- `comment` — optional note to prepend

<a id="tool-outlook_move"></a>

### `outlook_move`

- `message_id` — Graph message ID to move
- `destination_folder` — target folder name or well-known name

<a id="tool-outlook_flag"></a>

### `outlook_flag`

- `message_id` — Graph message ID
- `flag_status` — `flagged`, `complete`, or `notFlagged`

<a id="tool-outlook_calendar_fetch"></a>

### `outlook_calendar_fetch`

- `calendar` — `personal`, `family`, or `all` (default: `all`)
- `days` — number of days ahead to fetch (default: `7`)

<a id="tool-outlook_create_event"></a>

### `outlook_create_event`

- `subject` — event title
- `start` — start datetime ISO (e.g. `2026-03-15T14:00`)
- `duration` — duration string e.g. `1h`, `30m` (default: `1h`; ignored if `end` supplied)
- `end` — end datetime ISO (overrides duration)
- `timezone` — IANA timezone (default: `America/Los_Angeles`)
- `location` — optional location
- `description` — optional description
- `attendees` — optional attendee emails
- `calendar` — `personal` or `family` (default: `personal`)

<a id="tool-outlook_update_event"></a>

### `outlook_update_event`

- `event_id` — Graph event ID from `outlook_calendar_fetch`
- `subject`, `start`, `end`, `duration`, `timezone`, `location`, `description` — optional updates
- `add_attendees` — emails to add
- `remove_attendees` — emails to remove
- `status` — `confirmed`, `tentative`, or `cancelled`

<a id="tool-outlook_delete_event"></a>

### `outlook_delete_event`

- `event_id` — Graph event ID to delete

<a id="tool-outlook_meeting"></a>

### `outlook_meeting`

- `to` — required attendee email(s)
- `cc` — optional attendees (marked optional)
- `subject` — meeting title
- `start` — start datetime ISO
- `duration` — duration string (default: `1h`)
- `end` — end datetime ISO (overrides duration)
- `timezone` — IANA timezone (default: `America/Los_Angeles`)
- `location`, `description`, `signature` — optional

<a id="tool-outlook_query_events"></a>

### `outlook_query_events`

- `after` — events at or after this date (ISO)
- `before` — events before this date (ISO)
- `text` — title text filter
- `attendee` — filter by attendee email
- `uid` — exact iCalUId match

---

Built with [Carapace Plugin SDK](https://github.com/JeffSteinbok/carapace-plugin-sdk).

```bash
cd plugins/outlook
npm install && npm run build
node dist/bin/outlook.js --help
```
