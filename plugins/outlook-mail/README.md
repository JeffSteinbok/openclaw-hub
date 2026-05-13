# Outlook Mail

Read and search personal Outlook mail from OpenClaw. Use it for inbox triage, keyword searches, attachment saves, and opening a specific message when you need the full body content.

## Tools

| Tool | Description |
|------|-------------|
| [`outlook_inbox`](#tool-outlook_inbox) | List recent messages from the Outlook inbox or another mail folder |
| [`outlook_search`](#tool-outlook_search) | Search messages by query text, sender, subject, or date range |
| [`outlook_read`](#tool-outlook_read) | Read a specific message by ID, including full body content |
| [`outlook_save_attachments`](#tool-outlook_save_attachments) | Save matching attachments from a message to a local directory |

## Configuration Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `clientId` | string | Optional | Microsoft Graph OAuth2 client ID |
| `clientSecret` | string | Optional | Microsoft Graph OAuth2 client secret |
| `refreshToken` | string | Optional | Microsoft Graph OAuth2 refresh token |

## Example config

Set Outlook Mail under `plugins.entries["outlook-mail"].config`:

```json
{
  "plugins": {
    "entries": {
      "outlook-mail": {
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

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OUTLOOK_CLIENT_ID` | No | Backing value for plugin config `clientId` |
| `OUTLOOK_CLIENT_SECRET` | No | Backing value for plugin config `clientSecret` |
| `OUTLOOK_REFRESH_TOKEN` | No | Backing value for plugin config `refreshToken` |

## Tool Parameters

<a id="tool-outlook_inbox"></a>

### `outlook_inbox`

- `limit` — optional maximum number of messages to return (default `10`)
- `unread` — optional flag to show only unread messages
- `folder` — optional Outlook folder name to read (default `inbox`)

<a id="tool-outlook_search"></a>

### `outlook_search`

- `query` — optional full-text search across subject and body
- `from` — optional sender email address filter
- `subject` — optional subject substring filter
- `since` — optional start date in `YYYY-MM-DD`
- `before` — optional end date in `YYYY-MM-DD`
- `limit` — optional maximum number of results (default `10`)

<a id="tool-outlook_read"></a>

### `outlook_read`

- `message_id` — required Microsoft Graph message ID to retrieve

<a id="tool-outlook_save_attachments"></a>

### `outlook_save_attachments`

- `message_id` — required Microsoft Graph message ID
- `output_dir` — required local directory path to save attachments into
- `content_types` — optional content-type filters such as `image/*`

## Notes

- This is for reading personal Outlook mail. Never use Fastmail for reading personal mail.
- Uses the same Graph API OAuth2 credentials as the `outlook-calendar` plugin.

## Plugin Structure

```
openclaw.plugin.json
src/tools.py
src/outlook_mail.py
```

---

## CLI Usage

Built with [Carapace Plugin SDK](https://github.com/JeffSteinbok/carapace-plugin-sdk).

All tools are also available as a standalone CLI:

```bash
cd plugins/outlook-mail
npm install && npm run build
node dist/bin/outlook-mail.js --help
```

### Example commands

```bash
node dist/bin/outlook-mail.js outlook-inbox ...
node dist/bin/outlook-mail.js outlook-search ...
node dist/bin/outlook-mail.js outlook-read ...
node dist/bin/outlook-mail.js outlook-save-attachments ...

# JSON output
node dist/bin/outlook-mail.js <command> [args...] --json
```

### CLI Environment Variables

| Variable | Description |
|----------|-------------|
| `OUTLOOK_MAIL_CLIENT_ID` | Microsoft OAuth client ID |
| `OUTLOOK_MAIL_CLIENT_SECRET` | Microsoft OAuth client secret |
| `OUTLOOK_MAIL_REFRESH_TOKEN` | Microsoft OAuth refresh token |
