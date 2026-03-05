---
name: fastmail-send
description: Send email and meeting requests via Fastmail JMAP. Use when asked to send an email, compose a message, or create a meeting/calendar invite. Supports plain email, meeting requests with accept/decline buttons, and updating existing calendar events.
metadata:
  openclaw:
    emoji: "📧"
    requires:
      env: ["FASTMAIL_JMAP_TOKEN", "FASTMAIL_ACCOUNT_ID"]
---

# Fastmail Send

Send email and meeting requests from `octo@steinbok.net` (as "Octo") via Fastmail JMAP.

## Config env vars

| Variable               | Required | Default              | Description                                |
|------------------------|----------|----------------------|--------------------------------------------|
| `FASTMAIL_JMAP_TOKEN`  | ✓        | —                    | API bearer token                           |
| `FASTMAIL_ACCOUNT_ID`  | ✓        | —                    | JMAP account ID (e.g. `REDACTED_ACCOUNT_ID`)         |
| `FASTMAIL_IDENTITY_ID` |          | `REDACTED_IDENTITY_ID`          | EmailIdentity ID for submission            |
| `FASTMAIL_FROM_EMAIL`  |          | `octo@steinbok.net`  | Sender address                             |
| `FASTMAIL_CALENDAR_ID` |          | *(server default)*   | Calendar to create events in (optional)    |

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
- `--no-jmap-calendar` — force MIME/iCal fallback, skip JMAP Calendar API

### How it works

1. **JMAP Calendar path** (preferred): If the account has the `urn:ietf:params:jmap:calendars`
   capability, the script calls `CalendarEvent/set` with `sendSchedulingMessages: true`.
   The server creates the event in the organizer's calendar **and** sends iMIP invite emails
   to all attendees automatically.

2. **MIME fallback**: If JMAP Calendar is unavailable (or `--no-jmap-calendar` is passed),
   the script assembles a `multipart/alternative` MIME message with a `text/calendar;method=REQUEST`
   part. This produces the standard accept/decline buttons in mail clients, but the event is
   **not** added to the organizer's calendar.

---

## Update a calendar event

Requires JMAP Calendar capability on the account.

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

## Notes

- Always pass `--signature` separately from `--body`/`--description`; the script appends it.
- The `--to` / `--cc` flags accept multiple addresses: `--to a@x.com b@x.com`
- Token is loaded from `FASTMAIL_JMAP_TOKEN` env var or `~/.fastmail_token`.
- UIDs are printed on meeting creation — save them to reference events later.
