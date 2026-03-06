---
name: fastmail-send
description: Send email and meeting requests via Fastmail JMAP and CalDAV. Use when asked to send an email, compose a message, or create a meeting/calendar invite. Supports plain email, meeting requests with accept/decline buttons, updating existing calendar events, and querying events with RSVP status.
metadata:
  openclaw:
    emoji: "📧"
    requires:
      env: ["FASTMAIL_JMAP_TOKEN", "FASTMAIL_ACCOUNT_ID", "CALDAV_URL", "CALDAV_USERNAME", "CALDAV_PASSWORD"]
---

# Fastmail Send

Send email and meeting requests from `octo@steinbok.net` (as "Octo") via Fastmail JMAP.
Calendar events are created via CalDAV, which adds them to the organizer's calendar
and sends iMIP invite emails to attendees.

## Config env vars

| Variable                | Required | Default              | Description                                            |
|-------------------------|----------|----------------------|--------------------------------------------------------|
| `FASTMAIL_JMAP_TOKEN`   | ✓        | —                    | API bearer token                                       |
| `FASTMAIL_ACCOUNT_ID`   | ✓        | —                    | JMAP account ID (e.g. `REDACTED_ACCOUNT_ID`)                    |
| `FASTMAIL_IDENTITY_ID`  |          | `REDACTED_IDENTITY_ID`          | EmailIdentity ID for submission                        |
| `FASTMAIL_FROM_EMAIL`   |          | `octo@steinbok.net`  | Sender address                                         |
| `CALDAV_URL`            | ✓        | —                    | CalDAV server base URL (e.g. `https://caldav.fastmail.com`) |
| `CALDAV_USERNAME`       | ✓        | —                    | CalDAV username (usually the account e-mail address)   |
| `CALDAV_PASSWORD`       | ✓        | —                    | CalDAV password or app-specific password               |
| `CALDAV_CALENDAR_PATH`  |          | *(auto-discovered)*  | CalDAV calendar collection path (optional)             |

---

## Send email

```bash
python3 <skill>/scripts/fastmail.py send \
  --to recipient@example.com \
  --subject "Subject line" \
  --body "Email body text" \
  --signature "---\nSent by Octo..."
```

Optional: `--cc addr1 addr2`, `--attachment file1.pdf file2.pdf`

---

## Send meeting request

```bash
python3 <skill>/scripts/fastmail.py meeting \
  --to recipient@example.com \
  --subject "Meeting title" \
  --start 2026-03-15T14:00 \
  --duration 1h \
  --location "Home" \
  --description "Agenda or notes" \
  --signature "---\nSent by Octo..."
```

Optional flags:
- `--cc addr1 addr2`
- `--timezone IANA_TZ` (default: `America/Los_Angeles`)
- `--duration` accepts `30m`, `1.5h`, `90` (bare number = minutes; default: `1h`)

### How it works

Creates the event in the organizer's CalDAV calendar via `PUT`, then sends iMIP
invite emails to attendees via JMAP MIME upload. The event appears on the
organizer's calendar immediately. CalDAV calendar path is auto-discovered
from `CALDAV_USERNAME` if `CALDAV_CALENDAR_PATH` is not set.

Requires `CALDAV_URL`, `CALDAV_USERNAME`, and `CALDAV_PASSWORD`.

RSVP state (attendee responses) is automatically tracked in
`~/.openclaw/services/meeting-rsvp.json`.

---

## Update a calendar event

Finds and updates events via CalDAV. Requires the same `CALDAV_*` env vars.

```bash
python3 <skill>/scripts/fastmail.py update-event \
  --uid "abc123@steinbok.net" \
  --new-title "Rescheduled Meeting" \
  --new-start 2026-03-20T15:00 \
  --new-duration 30m \
  --new-location "Teams call" \
  --add-attendee newperson@example.com \
  --remove-attendee oldperson@example.com
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
python3 <skill>/scripts/fastmail.py query-events \
  --after 2026-03-01 \
  --before 2026-04-01
```

Optional filters:
- `--text QUERY` — free-text filter on event title / description
- `--attendee EMAIL` — only show events that include this attendee
- `--uid UID` — return the single event with this exact UID

### How it works

Queries the CalDAV calendar for events in the specified date range. RSVP statuses
are read directly from attendee `PARTSTAT` values in the iCalendar data and synced
to the local state file at `~/.openclaw/services/meeting-rsvp.json`.

### Output example

```
📅 Project Sync
   Date:     20260315T140000 – 20260315T150000
   Location: Zoom
   UID:      abc123@steinbok.net
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
- CalDAV URL for Fastmail is `https://caldav.fastmail.com` (no trailing slash).
