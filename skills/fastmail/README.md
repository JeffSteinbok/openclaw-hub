# Fastmail Skill

Send email, search inboxes, and manage calendar events via [Fastmail](https://www.fastmail.com) JMAP and CalDAV.

## What It Does

- **Send email** — plain-text messages with optional attachments
- **Search & read inbox** — full-text search, filter by sender/subject/date, read full messages
- **Meeting requests** — CalDAV-based invites with iMIP accept/decline buttons
- **Update events** — reschedule, add/remove attendees, cancel
- **Query events** — search by date range, text, or UID; shows RSVP status

## How It Works

The skill contains two scripts:

| Script | Purpose |
|---|---|
| `scripts/fastmail.py` | Send email, create/update/query calendar events |
| `scripts/fastmail_search.py` | Search and read inbox messages |

Both scripts authenticate via a Fastmail JMAP API token (env var or `~/.fastmail_token`). All non-secret configuration (account IDs, mailbox IDs, CalDAV paths) is passed as CLI arguments — nothing is hardcoded.

Calendar operations use CalDAV (via `scripts/caldav_client.py`) to create events directly on the server, which then sends standard iMIP invitations to attendees.

## Quick Examples

```bash
# Search an inbox for recent messages
python3 scripts/fastmail_search.py --account-id <ACCOUNT_ID> inbox --limit 10

# Full-text search
python3 scripts/fastmail_search.py --account-id <ACCOUNT_ID> search --query "flight confirmation"

# Read a specific email
python3 scripts/fastmail_search.py --account-id <ACCOUNT_ID> read --id <EMAIL_ID>

# Send an email
python3 scripts/fastmail.py --account-id <ID> --identity-id <ID> --drafts-id <ID> --sent-id <ID> \
  send --to alice@example.com --subject "Hello" --body "Message body"

# Create a meeting
python3 scripts/fastmail.py --account-id <ID> --identity-id <ID> --drafts-id <ID> --sent-id <ID> \
  --caldav-url https://caldav.fastmail.com --caldav-username user@example.com \
  meeting --to bob@example.com --subject "Sync" --start 2026-03-15T14:00 --duration 1h
```

## Setup

1. Generate a Fastmail API token at [Settings → Privacy & Security → API tokens](https://www.fastmail.com/settings/security/tokens)
2. Set the `FASTMAIL_JMAP_TOKEN` environment variable (or save to `~/.fastmail_token`)
3. For calendar features, also set `FASTMAIL_CALDAV_PASSWORD`
4. Look up your account's mailbox IDs via the JMAP API or Fastmail admin — pass them as CLI args

See [SKILL.md](SKILL.md) for the full reference.
