# Outlook Mail

Read and search personal Outlook mail from OpenClaw. Use it for inbox triage, keyword searches, and opening a specific message when you need the full body content.

## Tools

| Tool | Description |
|------|-------------|
| `outlook_inbox` | List recent messages from the Outlook inbox |
| `outlook_search` | Search messages by query text, sender, subject, or date range |
| `outlook_read` | Read a specific message by ID, including full body content |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OUTLOOK_CLIENT_ID` | Microsoft Graph OAuth2 client ID |
| `OUTLOOK_CLIENT_SECRET` | Microsoft Graph OAuth2 client secret |
| `OUTLOOK_REFRESH_TOKEN` | OAuth2 refresh token for token renewal |

## Notes

- This is for reading personal Outlook mail. Never use Fastmail for reading personal mail.
- Uses the same Graph API OAuth2 credentials as the `outlook-calendar` plugin.

## Plugin Structure

```
openclaw.plugin.json
src/tools.py
src/outlook_mail.py
```
