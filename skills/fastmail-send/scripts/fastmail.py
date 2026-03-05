#!/usr/bin/env python3
"""Send email and meeting requests via Fastmail JMAP.

Supports two commands:
  send    – plain-text email with optional file attachments
  meeting – calendar invite (iCalendar REQUEST) with accept/decline support

Auth: reads FASTMAIL_JMAP_TOKEN from env or ~/.fastmail_token.
"""

import argparse, json, mimetypes, os, sys, uuid
from datetime import datetime, timedelta, timezone
from email.encoders import encode_base64
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate, make_msgid
from email.policy import SMTP as SMTP_POLICY
from urllib.request import Request, urlopen

# ── Config ────────────────────────────────────────────────────
JMAP_API    = "https://api.fastmail.com/jmap/api/"
ACCOUNT_ID  = "***REDACTED_ACCOUNT***"
IDENTITY_ID = "176075455"
FROM_EMAIL  = "octo@steinbok.net"
FROM_NAME   = "Octo (Jeff's Assistant)"
DRAFTS_ID   = "P3V"
SENT_ID     = "P2F"
UPLOAD_URL  = f"https://api.fastmail.com/jmap/upload/{ACCOUNT_ID}/"

def get_token():
    """Return API token from env var, falling back to dotfile."""
    t = os.environ.get("FASTMAIL_JMAP_TOKEN")
    if t: return t
    p = os.path.expanduser("~/.fastmail_token")
    if os.path.exists(p):
        with open(p) as f:
            return f.read().strip()
    sys.exit("FASTMAIL_JMAP_TOKEN not found (checked env + ~/.fastmail_token)")

# ── JMAP helpers ──────────────────────────────────────────────
def http_post(url, token, data, ct="application/json"):
    r = Request(url, data, {"Authorization": f"Bearer {token}", "Content-Type": ct})
    with urlopen(r) as resp:
        return json.loads(resp.read())

def jmap(token, calls, using=None):
    """Execute one or more JMAP method calls in a single request."""
    using = using or ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail",
                      "urn:ietf:params:jmap:submission"]
    return http_post(JMAP_API, token, json.dumps({"using": using, "methodCalls": calls}).encode())

def check(result):
    """Exit on any JMAP error."""
    for name, data, _tag in result["methodResponses"]:
        if name == "error":
            sys.exit(f"JMAP error: {data.get('type')}: {data.get('description', '')}")
        if isinstance(data, dict):
            # notCreated / notImported indicate partial failures within a batch
            for k in ("notCreated", "notImported"):
                if data.get(k):
                    sys.exit(f"{name} failed: {json.dumps(data[k])}")

def submit_call(email_ref, recipients):
    """EmailSubmission/set method call. email_ref is an id or '#creation_id'."""
    return ["EmailSubmission/set", {
        "accountId": ACCOUNT_ID,
        "create": {"s": {
            "emailId": email_ref, "identityId": IDENTITY_ID,
            "envelope": {"mailFrom": {"email": FROM_EMAIL},
                         "rcptTo": [{"email": e} for e in recipients]}
        }},
        "onSuccessUpdateEmail": {
            "#s": {
                f"mailboxIds/{DRAFTS_ID}": None,   # remove from Drafts
                f"mailboxIds/{SENT_ID}": True,      # move to Sent
                "keywords/$seen": True,             # mark as read
            }
        }
    }, "submit"]

def body_with_sig(content, signature):
    return f"{content}\n\n{signature}" if signature else content

def build_mime_headers(msg, args):
    """Set common MIME headers on a message."""
    msg["From"] = f"{FROM_NAME} <{FROM_EMAIL}>"
    msg["To"] = ", ".join(args.to)
    if args.cc: msg["Cc"] = ", ".join(args.cc)
    msg["Subject"] = args.subject
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain="steinbok.net")

def attach_file(msg, filepath):
    """Attach a file to a MIME message."""
    if not os.path.isfile(filepath):
        sys.exit(f"Attachment not found: {filepath}")
    ct, _ = mimetypes.guess_type(filepath)
    if ct is None:
        ct = "application/octet-stream"               # safe fallback for unknown types
    maintype, subtype = ct.split("/", 1)
    with open(filepath, "rb") as f:
        part = MIMEBase(maintype, subtype)
        part.set_payload(f.read())
    encode_base64(part)
    part.add_header("Content-Disposition", "attachment",
                    filename=os.path.basename(filepath))
    msg.attach(part)

def upload_and_submit(token, msg, recipients):
    """Upload a MIME blob to Fastmail, import it as a draft, then submit it."""
    # Upload raw bytes and get a blobId back
    blob = http_post(UPLOAD_URL, token, msg.as_bytes(policy=SMTP_POLICY), "message/rfc822")
    # Import blob into Drafts, then submit in a single JMAP batch
    result = jmap(token, [
        ["Email/import", {"accountId": ACCOUNT_ID,
         "emails": {"m": {"blobId": blob["blobId"], "mailboxIds": {DRAFTS_ID: True}}}}, "import"],
        submit_call("#m", recipients),  # #m references the just-imported email
    ])
    check(result)

# ── send: native Email/set or MIME upload (with attachments) ──
def cmd_send(args):
    token = get_token()
    recipients = args.to + (args.cc or [])

    if not args.attachment:
        # Fast path: native JMAP Email/set (no MIME assembly needed)
        email_obj = {
            "mailboxIds": {DRAFTS_ID: True},
            "from": [{"name": FROM_NAME, "email": FROM_EMAIL}],
            "to": [{"email": e} for e in args.to],
            "subject": args.subject,
            "bodyStructure": {"type": "text/plain", "partId": "1"},
            "bodyValues": {"1": {"value": body_with_sig(args.body, args.signature)}},
        }
        if args.cc:
            email_obj["cc"] = [{"email": e} for e in args.cc]

        # Create draft + submit in one JMAP round-trip
        result = jmap(token, [
            ["Email/set", {"accountId": ACCOUNT_ID, "create": {"e": email_obj}}, "create"],
            submit_call("#e", recipients),  # #e back-references the created email
        ])
        check(result)
    else:
        # Slow path: build full MIME message to support file attachments
        msg = MIMEMultipart("mixed")
        build_mime_headers(msg, args)
        msg.attach(MIMEText(body_with_sig(args.body, args.signature), "plain", "utf-8"))
        for filepath in args.attachment:
            attach_file(msg, filepath)
        upload_and_submit(token, msg, recipients)

    att_note = f" ({len(args.attachment)} attachment(s))" if args.attachment else ""
    print(f"Sent to {', '.join(args.to)}: {args.subject}{att_note}")

# ── meeting: raw MIME upload + Email/import (Content-Type params) ─
def cmd_meeting(args):
    token = get_token()
    recipients = args.to + (args.cc or [])

    try:
        start = datetime.fromisoformat(args.start)
    except ValueError:
        sys.exit(f"Invalid start datetime: {args.start} (use ISO format, e.g. 2026-03-02T17:00)")
    # Parse duration string (e.g. "1h", "30m", "1.5h") into minutes
    d = args.duration.lower()
    try:
        mins = int(float(d[:-1]) * 60) if d.endswith("h") else int(d.rstrip("m"))
    except (ValueError, IndexError):
        sys.exit(f"Invalid duration: {args.duration} (use e.g. '1h', '30m', '1.5h')")
    end = start + timedelta(minutes=mins)
    tz = args.timezone
    uid = f"{uuid.uuid4()}@steinbok.net"             # globally unique event identifier
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")  # DTSTAMP in UTC

    def ical_escape(s):
        """Escape text per RFC 5545 §3.3.11."""
        return s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")

    # Build iCalendar VEVENT payload (RFC 5545, METHOD:REQUEST)
    ev = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Octo//OpenClaw//EN",
          "CALSCALE:GREGORIAN", "METHOD:REQUEST", "BEGIN:VEVENT",
          f"DTSTART;TZID={tz}:{start.strftime('%Y%m%dT%H%M%S')}",
          f"DTEND;TZID={tz}:{end.strftime('%Y%m%dT%H%M%S')}",
          f"DTSTAMP:{stamp}", f"UID:{uid}", f"SUMMARY:{ical_escape(args.subject)}"]
    if args.location:    ev.append(f"LOCATION:{ical_escape(args.location)}")
    if args.description: ev.append(f"DESCRIPTION:{ical_escape(args.description)}")
    ev.append(f"ORGANIZER;CN={FROM_NAME}:mailto:{FROM_EMAIL}")
    for addr in args.to:
        ev.append(f"ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE"
                  f";ROLE=REQ-PARTICIPANT:mailto:{addr}")
    ev += ["STATUS:CONFIRMED", "SEQUENCE:0", "END:VEVENT", "END:VCALENDAR"]

    # Text fallback for clients that can't render calendar parts
    text = args.description or ""

    # MIME structure: multipart/alternative → text/plain + text/calendar
    # "alternative" tells mail clients to show calendar UI with accept/decline buttons
    msg = MIMEMultipart("alternative")
    build_mime_headers(msg, args)
    msg.attach(MIMEText(body_with_sig(text, args.signature), "plain", "utf-8"))
    cal = MIMEText("\r\n".join(ev), "calendar", "utf-8")
    cal.set_param("method", "REQUEST")  # required for clients to treat as invite
    msg.attach(cal)

    # Upload raw MIME blob + import + submit
    upload_and_submit(token, msg, recipients)

    print(f"Meeting sent to {', '.join(args.to)}: {args.subject}")
    print(f"  {start.strftime('%a %b %d %I:%M %p')}–{end.strftime('%I:%M %p')} {tz}")
    if args.location: print(f"  Location: {args.location}")
    print(f"  UID: {uid}")

# ── CLI ───────────────────────────────────────────────────────
def main():
    p = argparse.ArgumentParser(prog="fastmail")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("send")
    s.add_argument("--to", nargs="+", required=True)
    s.add_argument("--cc", nargs="+")
    s.add_argument("--subject", "-s", required=True)
    s.add_argument("--body", "-b", required=True)
    s.add_argument("--signature")
    s.add_argument("--attachment", "-a", nargs="+", help="File path(s) to attach")

    m = sub.add_parser("meeting")
    m.add_argument("--to", nargs="+", required=True)
    m.add_argument("--cc", nargs="+")
    m.add_argument("--subject", "-s", required=True)
    m.add_argument("--start", required=True, help="ISO datetime e.g. 2026-03-02T17:00")
    m.add_argument("--duration", "-d", default="1h")
    m.add_argument("--location", "-l")
    m.add_argument("--description")
    m.add_argument("--timezone", default="America/Los_Angeles")
    m.add_argument("--signature")

    args = p.parse_args()
    # Dispatch subcommand to its handler
    {"send": cmd_send, "meeting": cmd_meeting}[args.cmd](args)

if __name__ == "__main__":
    main()
