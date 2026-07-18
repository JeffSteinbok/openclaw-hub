# Outlook

Unified mail and calendar tools for Outlook / Microsoft 365 via Microsoft Graph API. Replaces the former `outlook-mail` and `outlook-calendar` plugins.

## Setup

### 1. Register an Azure AD App

1. Go to the [Azure Portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Click **New registration**
3. Fill in:
   - **Name:** anything (e.g. `OpenClaw Outlook`)
   - **Supported account types:** select **Personal Microsoft accounts only** (for personal Outlook/Hotmail/Live accounts) — or **Accounts in any organizational directory and personal Microsoft accounts** if you need both work and personal
   - **Redirect URI:** choose **Public client/native (mobile & desktop)** and enter `http://localhost`
4. Click **Register**
5. Copy the **Application (client) ID** — this is your `OUTLOOK_CLIENT_ID`

### 2. Create a Client Secret

1. In your app registration, go to **Certificates & secrets → Client secrets**
2. Click **New client secret**, give it a description and expiry
3. Copy the **Value** immediately (it won't be shown again) — this is your `OUTLOOK_CLIENT_SECRET`

### 3. Configure API Permissions

1. Go to **API permissions → Add a permission → Microsoft Graph → Delegated permissions**
2. Add all of the following:
   - `Calendars.ReadWrite` — read and write calendar events
   - `Mail.ReadWrite` — read, move, flag, and manage mail
   - `Mail.Send` — send email
   - `offline_access` — required to get a refresh token
3. Click **Grant admin consent** if prompted (for work accounts); personal accounts consent at auth time

### 4. Get a Refresh Token (OAuth Flow)

Run the following to generate the authorization URL (replace `YOUR_CLIENT_ID`):

```
https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize
  ?client_id=YOUR_CLIENT_ID
  &response_type=code
  &redirect_uri=http%3A%2F%2Flocalhost
  &scope=Calendars.ReadWrite+Mail.ReadWrite+Mail.Send+offline_access
  &response_mode=query
```

> **Note:** Use `/consumers/` for personal Microsoft accounts. Use `/common/` only if your app registration is set to **All** audience.

1. Open the URL in your browser
2. Sign in and accept the permissions
3. You'll be redirected to `http://localhost/?code=...` — copy the `code` value
4. Exchange it for tokens:

```bash
curl -X POST https://login.microsoftonline.com/consumers/oauth2/v2.0/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "code=YOUR_CODE" \
  -d "redirect_uri=http://localhost" \
  -d "grant_type=authorization_code"
```

5. Copy the `refresh_token` from the response — this is your `OUTLOOK_REFRESH_TOKEN`

> **Important:** The refresh token is long-lived but scoped. If you need to add permissions later, you must repeat this OAuth flow — updating only the token without re-consenting will not grant new scopes.

### 5. Set Environment Variables

```bash
OUTLOOK_CLIENT_ID=your-app-client-id
OUTLOOK_CLIENT_SECRET=your-client-secret
OUTLOOK_REFRESH_TOKEN=your-refresh-token
```

### 6. Configure the Plugin

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

Credentials can be passed directly in config or via environment variables — env vars are the recommended approach.

---

## Configuration Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `clientId` | string | Yes | Azure app client ID |
| `clientSecret` | string | Yes | Azure app client secret |
| `refreshToken` | string | Yes | OAuth refresh token with mail + calendar scopes |
| `personalCalendarNames` | string[] | No | Additional calendar names to treat as personal (default: `["Calendar", "calendar"]`) |
| `familyCalendarNames` | string[] | No | Additional calendar names to treat as family (default: `["Your Family", "Family"]`) |

---

## Tools

### Mail

| Tool | Description |
|------|-------------|
| [`outlook_inbox`](#outlook_inbox) | List recent messages from inbox or another folder |
| [`outlook_search`](#outlook_search) | Search messages by text, sender, subject, or date range |
| [`outlook_read`](#outlook_read) | Read a specific message including full body |
| [`outlook_save_attachments`](#outlook_save_attachments) | Save attachments from a message to a local directory |
| [`outlook_send`](#outlook_send) | Send a plain-text email with optional attachments |
| [`outlook_reply`](#outlook_reply) | Reply to a message with proper threading |
| [`outlook_forward`](#outlook_forward) | Forward a message to new recipients |
| [`outlook_move`](#outlook_move) | Move a message to a different folder |
| [`outlook_flag`](#outlook_flag) | Flag, complete, or unflag a message |

### Calendar

| Tool | Description |
|------|-------------|
| [`outlook_calendar_fetch`](#outlook_calendar_fetch) | Fetch upcoming events from personal, family, or all calendars |
| [`outlook_create_event`](#outlook_create_event) | Create a new calendar event |
| [`outlook_update_event`](#outlook_update_event) | Update an existing event by ID |
| [`outlook_delete_event`](#outlook_delete_event) | Delete a calendar event by ID |
| [`outlook_meeting`](#outlook_meeting) | Create a meeting and send invites to attendees |
| [`outlook_query_events`](#outlook_query_events) | Query events by date range, text, attendee, or UID |

---

## Tool Reference

<a id="outlook_inbox"></a>

### `outlook_inbox`

| Param | Type | Description |
|-------|------|-------------|
| `folder` | string | Folder name (default: `inbox`). Well-known names: `inbox`, `junkemail`, `deleteditems`, `sentitems`, `drafts`, `outbox`, `archive` |
| `limit` | number | Max messages to return (default: `10`) |
| `unread` | boolean | Only return unread messages |

<a id="outlook_search"></a>

### `outlook_search`

| Param | Type | Description |
|-------|------|-------------|
| `query` | string | Full-text search across subject and body |
| `from` | string | Filter by sender email or domain |
| `subject` | string | Subject substring filter |
| `since` | string | Start date `YYYY-MM-DD` |
| `before` | string | End date `YYYY-MM-DD` |
| `limit` | number | Max results (default: `10`) |

<a id="outlook_read"></a>

### `outlook_read`

| Param | Type | Description |
|-------|------|-------------|
| `message_id` | string | Microsoft Graph message ID |

<a id="outlook_save_attachments"></a>

### `outlook_save_attachments`

| Param | Type | Description |
|-------|------|-------------|
| `message_id` | string | Microsoft Graph message ID |
| `output_dir` | string | Local directory to save attachments into |
| `content_types` | string[] | Content-type filters (default: `["image/*"]`) |

<a id="outlook_send"></a>

### `outlook_send`

| Param | Type | Description |
|-------|------|-------------|
| `to` | string \| string[] | Recipient email address(es) |
| `subject` | string | Email subject |
| `body` | string | Plain-text body |
| `cc` | string[] | CC recipients |
| `attachment` | string[] | Local file path(s) to attach |
| `in_reply_to` | string | Message-ID for threading (include angle brackets) |
| `references` | string | Space-separated Message-IDs for full thread References header |
| `signature` | string | Signature block appended after body |

<a id="outlook_reply"></a>

### `outlook_reply`

| Param | Type | Description |
|-------|------|-------------|
| `message_id` | string | Graph message ID to reply to |
| `body` | string | Reply body |
| `reply_all` | boolean | Reply to all recipients (default: `false`) |
| `signature` | string | Signature block |

<a id="outlook_forward"></a>

### `outlook_forward`

| Param | Type | Description |
|-------|------|-------------|
| `message_id` | string | Graph message ID to forward |
| `to` | string \| string[] | Recipient(s) to forward to |
| `comment` | string | Optional note to prepend |

<a id="outlook_move"></a>

### `outlook_move`

| Param | Type | Description |
|-------|------|-------------|
| `message_id` | string | Graph message ID to move |
| `destination_folder` | string | Target folder name or well-known name |

<a id="outlook_flag"></a>

### `outlook_flag`

| Param | Type | Description |
|-------|------|-------------|
| `message_id` | string | Graph message ID |
| `flag_status` | string | `flagged`, `complete`, or `notFlagged` |

<a id="outlook_calendar_fetch"></a>

### `outlook_calendar_fetch`

| Param | Type | Description |
|-------|------|-------------|
| `calendar` | string | `personal`, `family`, or `all` (default: `all`) |
| `days` | number | Days ahead to fetch (default: `7`) |

<a id="outlook_create_event"></a>

### `outlook_create_event`

| Param | Type | Description |
|-------|------|-------------|
| `subject` | string | Event title |
| `start` | string | Start datetime ISO (e.g. `2026-03-15T14:00`) |
| `duration` | string | Duration string e.g. `1h`, `30m` (default: `1h`; ignored if `end` supplied) |
| `end` | string | End datetime ISO (overrides duration) |
| `timezone` | string | IANA timezone (default: `America/Los_Angeles`) |
| `location` | string | Event location |
| `description` | string | Event description/body |
| `attendees` | string[] | Attendee email addresses |
| `calendar` | string | `personal` or `family` (default: `personal`) |

<a id="outlook_update_event"></a>

### `outlook_update_event`

| Param | Type | Description |
|-------|------|-------------|
| `event_id` | string | Graph event ID (from `outlook_calendar_fetch`) |
| `subject` | string | New title |
| `start` | string | New start datetime ISO |
| `end` | string | New end datetime ISO |
| `duration` | string | New duration (if no `end`) |
| `timezone` | string | IANA timezone for `start`/`end` |
| `location` | string | New location |
| `description` | string | New description |
| `add_attendees` | string[] | Emails to add as attendees |
| `remove_attendees` | string[] | Emails to remove from attendees |
| `status` | string | `confirmed`, `tentative`, or `cancelled` |

<a id="outlook_delete_event"></a>

### `outlook_delete_event`

| Param | Type | Description |
|-------|------|-------------|
| `event_id` | string | Graph event ID to delete |

<a id="outlook_meeting"></a>

### `outlook_meeting`

| Param | Type | Description |
|-------|------|-------------|
| `to` | string \| string[] | Required attendee email(s) |
| `cc` | string[] | Optional attendees (marked optional/informational) |
| `subject` | string | Meeting title |
| `start` | string | Start datetime ISO |
| `duration` | string | Duration string (default: `1h`) |
| `end` | string | End datetime ISO (overrides duration) |
| `timezone` | string | IANA timezone (default: `America/Los_Angeles`) |
| `location` | string | Meeting location |
| `description` | string | Agenda / meeting notes |
| `signature` | string | Signature block for the invite |

<a id="outlook_query_events"></a>

### `outlook_query_events`

| Param | Type | Description |
|-------|------|-------------|
| `after` | string | Events at or after this date (ISO, e.g. `2026-03-01`) |
| `before` | string | Events before this date (ISO, e.g. `2026-04-01`) |
| `text` | string | Filter by title/description text |
| `attendee` | string | Filter to events including this attendee email |
| `uid` | string | Return the single event with this exact iCalUId |

---

## Building

```bash
cd plugins/outlook
npm install && npm run build
node dist/bin/outlook.js --help
```

Built with [Carapace Plugin SDK](https://github.com/JeffSteinbok/carapace-plugin-sdk).
