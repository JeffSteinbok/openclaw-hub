---
name: fastmail-send
description: Send email and meeting requests via Fastmail JMAP. Use when asked to send an email, compose a message, or create a meeting/calendar invite. Supports plain email and meeting requests with accept/decline buttons.
metadata:
  openclaw:
    emoji: "📧"
    requires:
      env: ["FASTMAIL_JMAP_TOKEN"]
---

# Fastmail Send

Send email and meeting requests from `octo@steinbok.net` (as "Octo") via Fastmail JMAP.

## Send email

```bash
python3 <skill>/scripts/fastmail.py send \
  --to recipient@example.com \
  --subject "Subject line" \
  --body "Email body text" \
  --signature "---\nSent by Octo..."
```

Optional: `--cc addr1 addr2`

## Send meeting request (with accept/decline)

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

Optional: `--cc`, `--timezone` (default: America/Los_Angeles), `--duration` (default: 1h, accepts `30m`, `1.5h`, `90`)

## Notes

- Always pass `--signature` separately from `--body`; the script appends it
- Meeting requests produce proper iCalendar invitations with accept/decline buttons
- The `--to` flag accepts multiple addresses: `--to a@x.com b@x.com`
- Token is read from `FASTMAIL_JMAP_TOKEN` env var or `~/.openclaw/.env`
