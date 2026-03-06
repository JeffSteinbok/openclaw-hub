---
name: fastmail
description: Send email, search/read inbox, and manage meeting requests via Fastmail JMAP and CalDAV. Use when asked to send an email, compose a message, search the inbox, read emails, or create a meeting/calendar invite. Supports plain email, meeting requests with accept/decline buttons, updating existing calendar events, querying events with RSVP status, and searching/reading a shared inbox.
metadata:
  openclaw:
    emoji: "📧"
    requires:
      env: ["FASTMAIL_JMAP_TOKEN"]
---

# Fastmail Send & Search

Send email and meeting requests via Fastmail JMAP, and search/read inbox contents.
Calendar events are created via CalDAV, which adds them to the organizer's calendar
and sends iMIP invite emails to attendees.

## Secrets (env vars)

| Variable                   | Required | Description                        |
|----------------------------|----------|------------------------------------|
| `FASTMAIL_JMAP_TOKEN`      | ✓        | API bearer token                   |
| `FASTMAIL_CALDAV_PASSWORD` | for CalDAV | CalDAV password / app password   |

## CLI args (non-secret config)

All commands in `fastmail.py` require these args:

| Arg                        | Required | Description                        |
|----------------------------|----------|------------------------------------|
| `--account-id`             | ✓        | JMAP account ID                    |
| `--identity-id`            | ✓        | EmailIdentity ID for submission    |
| `--drafts-id`              | ✓        | Drafts mailbox ID                  |
| `--sent-id`                | ✓        | Sent mailbox ID                    |
| `--caldav-url`             | for CalDAV | CalDAV server base URL           |
| `--caldav-username`        | for CalDAV | CalDAV username                  |
| `--caldav-calendar-path`   |          | CalDAV calendar path (auto-discovered if unset) |

All commands in `fastmail_search.py` require:

| Arg                        | Required | Description                        |
|----------------------------|----------|------------------------------------|
| `--account-id`             | ✓        | JMAP account ID to search          |

---

## Search inbox

```bash
python3 <skill>/scripts/fastmail_search.py --account-id <ACCOUNT_ID> inbox --limit 10
python3 <skill>/scripts/fastmail_search.py --account-id <ACCOUNT_ID> inbox --unread
python3 <skill>/scripts/fastmail_search.py --account-id <ACCOUNT_ID> search --query "keyword"
python3 <skill>/scripts/fastmail_search.py --account-id <ACCOUNT_ID> search --from "sender@example.com"
python3 <skill>/scripts/fastmail_search.py --account-id <ACCOUNT_ID> search --subject "text" --since 2026-03-01
python3 <skill>/scripts/fastmail_search.py --account-id <ACCOUNT_ID> read --id <JMAP_EMAIL_ID>
```

---

## Send email

```bash
python3 <skill>/scripts/fastmail.py --account-id <ID> --identity-id <ID> --drafts-id <ID> --sent-id <ID> \
  send --to recipient@example.com --subject "Subject line" --body "Email body text" --signature "..."
```

Optional: `--cc addr1 addr2`, `--attachment file1.pdf file2.pdf`

---

## Send meeting request

```bash
python3 <skill>/scripts/fastmail.py --account-id <ID> --identity-id <ID> --drafts-id <ID> --sent-id <ID> \
  --caldav-url <URL> --caldav-username <USER> \
  meeting --to recipient@example.com --subject "Meeting title" \
  --start 2026-03-15T14:00 --duration 1h --location "Home" \
  --description "Agenda or notes" --signature "..."
```

Optional flags:
- `--cc addr1 addr2`
- `--timezone IANA_TZ` (default: `America/Los_Angeles`)
- `--duration` accepts `30m`, `1.5h`, `90` (bare number = minutes; default: `1h`)

### How it works

Creates the event in the organizer's CalDAV calendar via `PUT`, then sends iMIP
invite emails to attendees via JMAP MIME upload. The event appears on the
organizer's calendar immediately. CalDAV calendar path is auto-discovered
from `--caldav-username` if `--caldav-calendar-path` is not set.

RSVP state (attendee responses) is automatically tracked in
`~/.openclaw/services/meeting-rsvp.json`.

---

## Update a calendar event

```bash
python3 <skill>/scripts/fastmail.py --account-id <ID> --identity-id <ID> --drafts-id <ID> --sent-id <ID> \
  --caldav-url <URL> --caldav-username <USER> \
  update-event --uid "abc123@example.com" --new-title "Rescheduled Meeting" \
  --new-start 2026-03-20T15:00 --new-duration 30m
```

### Find the event

| Flag     | Description                                                  |
|----------|--------------------------------------------------------------|
| `--uid`  | Exact event UID (most reliable — printed when meeting created) |
| `--find` | Free-text search across title and description                |

If `--find` matches multiple events, the script lists them and exits unless `--force` is
also passed (which updates **all** matching events).

### Changeable fields

| Flag                  | Description                                         |
|-----------------------|-----------------------------------------------------|
| `--new-title TEXT`    | Replace the event title                             |
| `--new-start DATETIME`| New start time (ISO format, e.g. `2026-03-15T14:00`)|
| `--new-duration DUR`  | New duration (`1h`, `30m`, `1.5h`)                 |
| `--new-location TEXT` | Replace location                                    |
| `--new-description T` | Replace description/notes                           |
| `--status STATUS`     | `confirmed`, `tentative`, or `cancelled`            |
| `--add-attendee ADDR` | Add one or more attendees                           |
| `--remove-attendee A` | Remove one or more attendees by email               |
| `--no-notify`         | Skip iMIP update notifications to attendees         |
| `--timezone IANA_TZ`  | Timezone for interpreting `--new-start`             |

---

## Query events and RSVP status

```bash
python3 <skill>/scripts/fastmail.py --account-id <ID> --identity-id <ID> --drafts-id <ID> --sent-id <ID> \
  --caldav-url <URL> --caldav-username <USER> \
  query-events --after 2026-03-01 --before 2026-04-01
```

Optional filters:
- `--text QUERY` — free-text filter on event title / description
- `--attendee EMAIL` — only show events that include this attendee
- `--uid UID` — return the single event with this exact UID

### Output example

```
📅 Project Sync
   Date:     20260315T140000 – 20260315T150000
   Location: Zoom
   UID:      abc123@example.com
   Backend:  caldav
   Attendees:
     ✓ Alice <alice@example.com> (ACCEPTED)
     · Bob <bob@example.com> (NEEDS-ACTION)
     ✗ Carol <carol@example.com> (DECLINED)
```

RSVP icons: `✓` accepted · `✗` declined · `?` tentative · `·` needs-action · `→` delegated

---

## Notes

- Always pass `--signature` separately from `--body`/`--description`; the script appends it.
- The `--to` / `--cc` flags accept multiple addresses: `--to a@x.com b@x.com`
- Token is loaded from `FASTMAIL_JMAP_TOKEN` env var or `~/.fastmail_token`.
- UIDs are printed on meeting creation — save them to reference events later.
