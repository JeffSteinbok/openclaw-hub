#!/usr/bin/env python3
"""Send email and manage calendar events via Fastmail JMAP and/or CalDAV.

Supports commands:
  send          – plain-text email with optional file attachments
  meeting       – calendar invite with attendees; uses the best available backend:
                    1. JMAP CalendarEvent/set (preferred — server sends iMIP invites)
                    2. CalDAV PUT + MIME iMIP email (when CALDAV_* vars are set)
                    3. Raw MIME/iCal fallback (last resort)
  update-event  – find a CalendarEvent by UID or subject and modify it
  query-events  – search calendar events by date range / text / UID;
                    shows attendee RSVP status

Auth:
  Reads FASTMAIL_JMAP_TOKEN from env or ~/.fastmail_token.

Env vars (secrets only):
  FASTMAIL_JMAP_TOKEN      – API bearer token (required)
  FASTMAIL_CALDAV_PASSWORD – CalDAV password / app-specific password

CLI args (non-secret config):
  --account-id             – JMAP account ID (required)
  --identity-id            – EmailIdentity ID for submission (required)
  --drafts-id              – Drafts mailbox ID (required)
  --sent-id                – Sent mailbox ID (required)
  --caldav-url             – CalDAV server base URL
  --caldav-username        – CalDAV username
  --caldav-calendar-path   – CalDAV calendar collection path
  --calendar-id            – JMAP Calendar ID (optional)
"""

import argparse
import json
import mimetypes
import os
import re
import sys
import uuid
from datetime import datetime, timedelta, timezone
from email.encoders import encode_base64
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate, make_msgid
from email.policy import SMTP as SMTP_POLICY
from urllib.error import HTTPError
from urllib.request import Request, urlopen

# CalDAV client lives alongside this script
sys.path.insert(0, os.path.dirname(__file__))
from caldav_client import CalDAVClient, CalDAVError, parse_ical_event, update_ical_vevent  # noqa: E402

# ── Config ────────────────────────────────────────────────────────────────────

JMAP_API    = "https://api.fastmail.com/jmap/api/"
ACCOUNT_ID  = ""
IDENTITY_ID = ""
FROM_EMAIL  = os.environ.get("FASTMAIL_FROM_EMAIL", "octo@steinbok.net")
CALENDAR_ID = ""
FROM_NAME   = "Octo (Jeff's Assistant)"
DRAFTS_ID   = ""
SENT_ID     = ""

# CalDAV configuration (optional; enables JMAP → CalDAV → MIME fallback chain)
CALDAV_URL           = ""
CALDAV_USERNAME      = ""
CALDAV_PASSWORD      = os.environ.get("FASTMAIL_CALDAV_PASSWORD", "")
CALDAV_CALENDAR_PATH = ""

# RSVP state persistence: ~/.openclaw/services/meeting-rsvp.json
RSVP_STATE_FILE = os.path.expanduser("~/.openclaw/services/meeting-rsvp.json")

# JMAP capability URNs
CAP_CORE       = "urn:ietf:params:jmap:core"
CAP_MAIL       = "urn:ietf:params:jmap:mail"
CAP_SUBMISSION = "urn:ietf:params:jmap:submission"
CAP_CALENDARS  = "urn:ietf:params:jmap:calendars"

MAIL_CAPS      = [CAP_CORE, CAP_MAIL, CAP_SUBMISSION]
CALENDAR_CAPS  = [CAP_CORE, CAP_CALENDARS]

UPLOAD_URL = ""


# ── Auth ──────────────────────────────────────────────────────────────────────

def get_token() -> str:
    """Return API token from FASTMAIL_JMAP_TOKEN env var, falling back to dotfile."""
    t = os.environ.get("FASTMAIL_JMAP_TOKEN")
    if t:
        return t
    p = os.path.expanduser("~/.fastmail_token")
    if os.path.exists(p):
        with open(p) as f:
            return f.read().strip()
    sys.exit("FASTMAIL_JMAP_TOKEN not found (checked env + ~/.fastmail_token)")


def get_caldav_client() -> CalDAVClient | None:
    """Return a CalDAVClient if CALDAV_URL/USERNAME/PASSWORD are configured, else None."""
    if CALDAV_URL and CALDAV_USERNAME and CALDAV_PASSWORD:
        return CalDAVClient(CALDAV_URL, CALDAV_USERNAME, CALDAV_PASSWORD)
    return None


# ── RSVP state helpers ────────────────────────────────────────────────────────

def load_rsvp_state() -> dict:
    """Load RSVP tracking state from disk.

    Returns:
        Dict mapping event UID → event dict with attendee RSVP info.
        Returns an empty dict if the file does not exist or cannot be parsed.
    """
    if os.path.exists(RSVP_STATE_FILE):
        try:
            with open(RSVP_STATE_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def save_rsvp_state(state: dict) -> None:
    """Persist RSVP tracking state to disk.

    Creates parent directories if needed.  Writes atomically to a temp file
    then renames to avoid partial writes.

    Args:
        state: Dict mapping event UID → event dict.
    """
    os.makedirs(os.path.dirname(RSVP_STATE_FILE), exist_ok=True)
    tmp = RSVP_STATE_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp, RSVP_STATE_FILE)


def rsvp_record_event(
    uid: str,
    title: str,
    start: str,
    attendees: list[str],
    backend: str,
) -> None:
    """Record a new event in the RSVP state file with initial attendee statuses.

    All attendees are initialised to ``needs-action``.  Existing records for
    the same UID are overwritten.

    Args:
        uid:       Event UID.
        title:     Event title / summary.
        start:     ISO datetime string of the event start.
        attendees: List of attendee e-mail addresses.
        backend:   Which backend created the event: "jmap", "caldav", or "mime".
    """
    state = load_rsvp_state()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    state[uid] = {
        "uid":        uid,
        "title":      title,
        "start":      start,
        "backend":    backend,
        "organizer":  FROM_EMAIL,
        "attendees":  {
            addr: {"partstat": "needs-action", "name": "", "last_seen": now}
            for addr in attendees
        },
        "last_synced": now,
    }
    save_rsvp_state(state)


def rsvp_update_from_ical(uid: str, attendees: list[dict]) -> None:
    """Update attendee RSVP statuses in the state file from parsed iCalendar data.

    Args:
        uid:       Event UID to update.
        attendees: List of attendee dicts as returned by :func:`parse_ical_event`,
                   each with at least ``email`` and ``partstat`` keys.
    """
    state = load_rsvp_state()
    if uid not in state:
        return
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    stored = state[uid].setdefault("attendees", {})
    for att in attendees:
        email = att.get("email", "")
        if not email:
            continue
        stored.setdefault(email, {})
        stored[email]["partstat"]  = att.get("partstat", "needs-action")
        stored[email]["name"]      = att.get("name", stored[email].get("name", ""))
        stored[email]["last_seen"] = now
    state[uid]["last_synced"] = now
    save_rsvp_state(state)


# ── Core HTTP / JMAP helpers ──────────────────────────────────────────────────

def http_post(url: str, token: str, data: bytes, ct: str = "application/json") -> dict:
    """POST *data* to *url* with bearer auth; return parsed JSON response."""
    req = Request(url, data, {"Authorization": f"Bearer {token}", "Content-Type": ct})
    with urlopen(req) as resp:
        return json.loads(resp.read())


def jmap(token: str, calls: list, using: list | None = None) -> dict:
    """Execute one or more JMAP method calls in a single round-trip.

    Args:
        token:  API bearer token.
        calls:  List of [method, args, tag] triples.
        using:  JMAP capability URNs; defaults to mail + submission caps.

    Returns:
        Raw JMAP response dict (contains "methodResponses").
    """
    using = using or MAIL_CAPS
    payload = json.dumps({"using": using, "methodCalls": calls}).encode()
    return http_post(JMAP_API, token, payload)


def check(result: dict) -> None:
    """Inspect a JMAP response and exit on any error response or partial failure."""
    for name, data, _tag in result.get("methodResponses", []):
        if name == "error":
            sys.exit(f"JMAP error [{name}]: {data.get('type')}: {data.get('description', '')}")
        if isinstance(data, dict):
            # notCreated / notUpdated / notImported → partial failures in a batch
            for key in ("notCreated", "notUpdated", "notImported"):
                if data.get(key):
                    sys.exit(f"{name} failed ({key}): {json.dumps(data[key])}")


# ── Mail helpers ──────────────────────────────────────────────────────────────

def submit_call(email_ref: str, recipients: list[str]) -> list:
    """Build an EmailSubmission/set method call.

    Args:
        email_ref:  Email ID (or '#creation_id' back-reference).
        recipients: List of envelope recipient addresses.

    Returns:
        JMAP method call triple [method, args, tag].
    """
    return ["EmailSubmission/set", {
        "accountId": ACCOUNT_ID,
        "create": {"s": {
            "emailId": email_ref,
            "identityId": IDENTITY_ID,
            "envelope": {
                "mailFrom": {"email": FROM_EMAIL},
                "rcptTo": [{"email": e} for e in recipients],
            },
        }},
        "onSuccessUpdateEmail": {
            "#s": {
                f"mailboxIds/{DRAFTS_ID}": None,  # remove from Drafts
                f"mailboxIds/{SENT_ID}": True,    # move to Sent
                "keywords/$seen": True,           # mark as read
            }
        },
    }, "submit"]


def body_with_sig(content: str, signature: str | None) -> str:
    """Append *signature* to *content* with a blank-line separator."""
    return f"{content}\n\n{signature}" if signature else content


def build_mime_headers(msg, args) -> None:
    """Set standard MIME headers (From/To/Cc/Subject/Date/Message-ID) on *msg*."""
    msg["From"] = f"{FROM_NAME} <{FROM_EMAIL}>"
    msg["To"] = ", ".join(args.to)
    if args.cc:
        msg["Cc"] = ", ".join(args.cc)
    msg["Subject"] = args.subject
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain="steinbok.net")


def attach_file(msg, filepath: str) -> None:
    """Attach a file to *msg* (MIMEMultipart). Exits if the file is missing."""
    if not os.path.isfile(filepath):
        sys.exit(f"Attachment not found: {filepath}")
    ct, _ = mimetypes.guess_type(filepath)
    ct = ct or "application/octet-stream"
    maintype, subtype = ct.split("/", 1)
    with open(filepath, "rb") as f:
        part = MIMEBase(maintype, subtype)
        part.set_payload(f.read())
    encode_base64(part)
    part.add_header("Content-Disposition", "attachment", filename=os.path.basename(filepath))
    msg.attach(part)


def upload_and_submit(token: str, msg, recipients: list[str]) -> None:
    """Upload a MIME blob to Fastmail, import it as a draft, then submit it.

    Args:
        token:      API bearer token.
        msg:        Assembled MIME message object.
        recipients: Envelope recipient addresses.
    """
    blob = http_post(UPLOAD_URL, token, msg.as_bytes(policy=SMTP_POLICY), "message/rfc822")
    result = jmap(token, [
        ["Email/import", {
            "accountId": ACCOUNT_ID,
            "emails": {"m": {"blobId": blob["blobId"], "mailboxIds": {DRAFTS_ID: True}}},
        }, "import"],
        submit_call("#m", recipients),  # #m back-references the imported draft
    ])
    check(result)


# ── Calendar JMAP helpers ─────────────────────────────────────────────────────

def check_calendar_capability(token: str) -> bool:
    """Return True if the server supports the JMAP Calendars capability.

    Fetches /jmap/session to inspect declared accountCapabilities.
    """
    try:
        req = Request(
            "https://api.fastmail.com/jmap/session",
            headers={"Authorization": f"Bearer {token}"},
        )
        with urlopen(req) as resp:
            session = json.loads(resp.read())
        accounts = session.get("accounts", {})
        for acct in accounts.values():
            caps = acct.get("accountCapabilities", {})
            if CAP_CALENDARS in caps:
                return True
        return False
    except Exception:
        return False


def duration_to_iso8601(duration_str: str) -> str:
    """Convert a human-readable duration to an ISO 8601 duration string.

    Accepted formats: "1h", "30m", "1.5h", "90" (bare number = minutes).

    Examples:
        "1h"   → "PT1H"
        "30m"  → "PT30M"
        "1.5h" → "PT1H30M"
        "90"   → "PT1H30M"
    """
    d = duration_str.lower().strip()
    try:
        if d.endswith("h"):
            total_mins = int(round(float(d[:-1]) * 60))
        elif d.endswith("m"):
            total_mins = int(d[:-1])
        else:
            total_mins = int(d)
    except (ValueError, IndexError):
        sys.exit(f"Invalid duration: {duration_str!r} (use e.g. '1h', '30m', '1.5h')")

    hours, mins = divmod(total_mins, 60)
    if hours and mins:
        return f"PT{hours}H{mins}M"
    if hours:
        return f"PT{hours}H"
    return f"PT{mins}M"


def duration_to_minutes(duration_str: str) -> int:
    """Convert a human-readable duration string to total minutes."""
    d = duration_str.lower().strip()
    try:
        if d.endswith("h"):
            return int(round(float(d[:-1]) * 60))
        if d.endswith("m"):
            return int(d[:-1])
        return int(d)
    except (ValueError, IndexError):
        sys.exit(f"Invalid duration: {duration_str!r} (use e.g. '1h', '30m', '1.5h')")


def build_jscalendar_event(
    uid: str,
    subject: str,
    start: datetime,
    duration_str: str,
    timezone_str: str,
    location: str | None = None,
    description: str | None = None,
    attendees: list[str] | None = None,
) -> dict:
    """Build a JSCalendar event object (RFC 8984) for CalendarEvent/set.

    Args:
        uid:          Globally unique event identifier (e.g. UUID@domain).
        subject:      Event title/summary.
        start:        Naive datetime in the local timezone.
        duration_str: Human duration string ("1h", "30m", etc.).
        timezone_str: IANA timezone name (e.g. "America/Los_Angeles").
        location:     Optional human-readable location.
        description:  Optional plain-text description.
        attendees:    Optional list of attendee email addresses.

    Returns:
        JSCalendar event dict ready for use in CalendarEvent/set "create".
    """
    event: dict = {
        "@type": "Event",
        "uid": uid,
        "title": subject,
        "start": start.strftime("%Y-%m-%dT%H:%M:%S"),
        "timeZone": timezone_str,
        "duration": duration_to_iso8601(duration_str),
        "status": "confirmed",
        "sequence": 0,
        "showWithoutTime": False,
    }

    # Assign to a specific calendar if configured
    if CALENDAR_ID:
        event["calendarIds"] = {CALENDAR_ID: True}

    if location:
        event["locations"] = {
            "loc1": {"@type": "Location", "name": location}
        }

    if description:
        event["description"] = description

    # Build participants map (organizer + attendees)
    participants: dict = {
        "organizer": {
            "@type": "Participant",
            "name": FROM_NAME,
            "email": FROM_EMAIL,
            "roles": {"owner": True, "chair": True},
            "participationStatus": "accepted",
            "sendTo": {"imip": f"mailto:{FROM_EMAIL}"},
        }
    }
    for i, email in enumerate(attendees or []):
        participants[f"attendee{i + 1}"] = {
            "@type": "Participant",
            "email": email,
            "roles": {"attendee": True},
            "participationStatus": "needs-action",
            "expectReply": True,
            "sendTo": {"imip": f"mailto:{email}"},
        }

    event["participants"] = participants
    return event


def calendar_event_create(
    token: str,
    event_obj: dict,
    send_scheduling_messages: bool = True,
) -> str:
    """Create a CalendarEvent via JMAP CalendarEvent/set.

    When *send_scheduling_messages* is True, the server automatically sends
    iMIP invite emails to all external attendees listed in the event.

    Args:
        token:                    API bearer token.
        event_obj:                JSCalendar event dict (from build_jscalendar_event).
        send_scheduling_messages: Whether to send iMIP invites automatically.

    Returns:
        Server-assigned event ID string.
    """
    result = jmap(token, [
        ["CalendarEvent/set", {
            "accountId": ACCOUNT_ID,
            "sendSchedulingMessages": send_scheduling_messages,
            "create": {"ev": event_obj},
        }, "create"],
    ], using=CALENDAR_CAPS)
    check(result)

    for name, data, tag in result["methodResponses"]:
        if name == "CalendarEvent/set" and tag == "create":
            created = data.get("created", {})
            if "ev" in created:
                return created["ev"]["id"]

    sys.exit("CalendarEvent/set did not return a created event ID")


def calendar_event_query(
    token: str,
    uid: str | None = None,
    text: str | None = None,
    after: datetime | None = None,
    before: datetime | None = None,
) -> list[str]:
    """Query CalendarEvents matching the given filter criteria.

    At least one filter argument should be provided; passing none returns all
    events (subject to server-side limits).

    Args:
        token:  API bearer token.
        uid:    Match events with this exact UID.
        text:   Full-text search across title, description, etc.
        after:  Only return events starting at or after this UTC datetime.
        before: Only return events starting before this UTC datetime.

    Returns:
        List of matching event ID strings.
    """
    filter_obj: dict = {}
    if uid:
        filter_obj["uid"] = uid
    if text:
        filter_obj["text"] = text
    if after:
        filter_obj["after"] = after.strftime("%Y-%m-%dT%H:%M:%SZ")
    if before:
        filter_obj["before"] = before.strftime("%Y-%m-%dT%H:%M:%SZ")

    call_args: dict = {"accountId": ACCOUNT_ID}
    if filter_obj:
        call_args["filter"] = filter_obj

    result = jmap(token, [
        ["CalendarEvent/query", call_args, "query"],
    ], using=CALENDAR_CAPS)
    check(result)

    for name, data, _tag in result["methodResponses"]:
        if name == "CalendarEvent/query":
            return data.get("ids", [])
    return []


def calendar_event_get(token: str, event_ids: list[str]) -> list[dict]:
    """Fetch full JSCalendar event objects for the given IDs.

    Args:
        token:     API bearer token.
        event_ids: List of server-assigned event IDs to fetch.

    Returns:
        List of JSCalendar event dicts (may be shorter than *event_ids* if
        some were not found; check "notFound" in the raw response if needed).
    """
    result = jmap(token, [
        ["CalendarEvent/get", {
            "accountId": ACCOUNT_ID,
            "ids": event_ids,
        }, "get"],
    ], using=CALENDAR_CAPS)
    check(result)

    for name, data, _tag in result["methodResponses"]:
        if name == "CalendarEvent/get":
            return data.get("list", [])
    return []


def calendar_event_update(
    token: str,
    event_id: str,
    patches: dict,
    send_scheduling_messages: bool = True,
) -> dict:
    """Update a CalendarEvent using JMAP PatchObject semantics.

    Patches are JSON Pointer paths mapped to new values, e.g.:
        {"title": "New Title", "start": "2026-03-15T14:00:00"}

    Args:
        token:                    API bearer token.
        event_id:                 Server-assigned event ID (NOT the UID).
        patches:                  Dict of path → value updates.
        send_scheduling_messages: Whether to notify attendees of the change.

    Returns:
        Updated event dict from the server (may be empty if server returns null).
    """
    result = jmap(token, [
        ["CalendarEvent/set", {
            "accountId": ACCOUNT_ID,
            "sendSchedulingMessages": send_scheduling_messages,
            "update": {event_id: patches},
        }, "update"],
    ], using=CALENDAR_CAPS)
    check(result)

    for name, data, tag in result["methodResponses"]:
        if name == "CalendarEvent/set" and tag == "update":
            not_updated = data.get("notUpdated", {})
            if event_id in not_updated:
                sys.exit(f"Failed to update event: {json.dumps(not_updated[event_id])}")
            return data.get("updated", {}).get(event_id) or {}
    return {}


def calendar_event_destroy(token: str, event_id: str, send_scheduling_messages: bool = True) -> None:
    """Destroy (delete) a CalendarEvent.

    When *send_scheduling_messages* is True, the server sends cancellation
    notices to attendees.

    Args:
        token:                    API bearer token.
        event_id:                 Server-assigned event ID to destroy.
        send_scheduling_messages: Whether to notify attendees of the cancellation.
    """
    result = jmap(token, [
        ["CalendarEvent/set", {
            "accountId": ACCOUNT_ID,
            "sendSchedulingMessages": send_scheduling_messages,
            "destroy": [event_id],
        }, "destroy"],
    ], using=CALENDAR_CAPS)
    check(result)


# ── iCalendar helper (for MIME fallback) ──────────────────────────────────────

def ical_escape(s: str) -> str:
    """Escape a string per RFC 5545 §3.3.11 (Text value type)."""
    return s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def build_ical_vevent(
    uid: str,
    subject: str,
    start: datetime,
    end: datetime,
    timezone_str: str,
    location: str | None = None,
    description: str | None = None,
    attendees: list[str] | None = None,
    sequence: int = 0,
    method: str = "REQUEST",
) -> str:
    """Build an iCalendar VCALENDAR/VEVENT string (RFC 5545, METHOD:REQUEST).

    Args:
        uid:          Globally unique event identifier.
        subject:      Event summary.
        start:        Naive datetime in *timezone_str* timezone.
        end:          Naive datetime in *timezone_str* timezone.
        timezone_str: IANA timezone name.
        location:     Optional location string.
        description:  Optional description.
        attendees:    Optional list of attendee email addresses.
        sequence:     SEQUENCE number (increment on updates).
        method:       iTIP method (REQUEST, CANCEL, etc.).

    Returns:
        Folded iCalendar string with \\r\\n line endings.
    """
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Octo//OpenClaw//EN",
        "CALSCALE:GREGORIAN",
        f"METHOD:{method}",
        "BEGIN:VEVENT",
        f"DTSTART;TZID={timezone_str}:{start.strftime('%Y%m%dT%H%M%S')}",
        f"DTEND;TZID={timezone_str}:{end.strftime('%Y%m%dT%H%M%S')}",
        f"DTSTAMP:{stamp}",
        f"UID:{uid}",
        f"SUMMARY:{ical_escape(subject)}",
        f"SEQUENCE:{sequence}",
        f"STATUS:CONFIRMED",
        f"ORGANIZER;CN={FROM_NAME}:mailto:{FROM_EMAIL}",
    ]
    if location:
        lines.append(f"LOCATION:{ical_escape(location)}")
    if description:
        lines.append(f"DESCRIPTION:{ical_escape(description)}")
    for addr in (attendees or []):
        lines.append(
            f"ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;ROLE=REQ-PARTICIPANT:mailto:{addr}"
        )
    lines += ["END:VEVENT", "END:VCALENDAR"]
    return "\r\n".join(lines)


# ── cmd: send ─────────────────────────────────────────────────────────────────

def cmd_send(args) -> None:
    """Send a plain-text email, optionally with file attachments."""
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

        result = jmap(token, [
            ["Email/set", {"accountId": ACCOUNT_ID, "create": {"e": email_obj}}, "create"],
            submit_call("#e", recipients),  # #e back-references the created draft
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
    print(f"✓ Sent to {', '.join(args.to)}: {args.subject}{att_note}")


# ── cmd: meeting ──────────────────────────────────────────────────────────────

def _caldav_calendar_path(client: CalDAVClient) -> str:
    """Return the configured CalDAV calendar path, or auto-discover it.

    Args:
        client: Authenticated :class:`CalDAVClient`.

    Returns:
        Calendar collection path to use for event operations.

    Raises:
        SystemExit: If no calendar path is configured and none can be discovered.
    """
    if CALDAV_CALENDAR_PATH:
        return CALDAV_CALENDAR_PATH
    calendars = client.discover_calendars()
    if not calendars:
        sys.exit(
            "CalDAV: no calendars discovered at the configured base URL.\n"
            "Set CALDAV_CALENDAR_PATH explicitly."
        )
    # Prefer the first non-inbox calendar by display name
    path = calendars[0]["href"]
    print(f"  CalDAV auto-discovered calendar: {calendars[0]['display_name']!r} → {path}")
    return path


def cmd_meeting(args) -> None:
    """Create a calendar meeting invite and send it to attendees.

    Creates the event in the organizer's CalDAV calendar via PUT, then
    sends iMIP invite emails to attendees via JMAP MIME upload.
    Requires CALDAV_URL, CALDAV_USERNAME, and CALDAV_PASSWORD env vars.
    """
    token = get_token()
    recipients = args.to + (args.cc or [])

    # ── Parse inputs ──────────────────────────────────────────
    try:
        start = datetime.fromisoformat(args.start)
    except ValueError:
        sys.exit(f"Invalid start datetime: {args.start!r} (use ISO format, e.g. 2026-03-15T14:00)")

    mins = duration_to_minutes(args.duration)
    end  = start + timedelta(minutes=mins)
    tz   = args.timezone
    uid  = f"{uuid.uuid4()}@steinbok.net"
    all_attendees = args.to + (args.cc or [])

    # ── CalDAV: create event + send iMIP invites ──────────────
    caldav = get_caldav_client()
    if caldav is None:
        sys.exit("CalDAV not configured. Set CALDAV_URL, CALDAV_USERNAME, and CALDAV_PASSWORD.")

    ical_str = build_ical_vevent(
        uid=uid,
        subject=args.subject,
        start=start,
        end=end,
        timezone_str=tz,
        location=args.location,
        description=args.description,
        attendees=all_attendees,
    )

    cal_path = _caldav_calendar_path(caldav)
    print(f"Using CalDAV PUT → {cal_path} …")
    resource_path = caldav.create_event(cal_path, uid, ical_str)
    print(f"  Event resource: {resource_path}")

    # Send iMIP invite emails via JMAP MIME
    print("Sending iMIP invite emails via JMAP …")
    text_body = body_with_sig(args.description or "", args.signature)
    msg = MIMEMultipart("alternative")
    build_mime_headers(msg, args)
    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    cal_part = MIMEText(ical_str, "calendar", "utf-8")
    cal_part.set_param("method", "REQUEST")
    msg.attach(cal_part)
    upload_and_submit(token, msg, recipients)

    rsvp_record_event(uid, args.subject, args.start, all_attendees, backend="caldav")
    print(f"✓ Calendar event created via CalDAV + invites sent: {args.subject}")
    print(f"  {start.strftime('%a %b %d %I:%M %p')}–{end.strftime('%I:%M %p')} {tz}")
    if args.location:
        print(f"  Location: {args.location}")
    print(f"  UID: {uid}")


# ── cmd: update-event ─────────────────────────────────────────────────────────

def cmd_update_event(args) -> None:
    """Find a calendar event by UID or subject, then apply requested changes via CalDAV.

    Discovery order:
      1. If --uid is provided: query by exact UID (deterministic).
      2. If --find is provided: text search across event titles.

    After locating the event, applies any combination of:
      --new-title, --new-start, --new-duration, --new-location,
      --new-description, --add-attendee, --remove-attendee,
      --timezone (used when interpreting --new-start)

    Requires CALDAV_URL, CALDAV_USERNAME, and CALDAV_PASSWORD env vars.
    """
    token = get_token()
    caldav = get_caldav_client()
    if caldav is None:
        sys.exit("CalDAV not configured. Set CALDAV_URL, CALDAV_USERNAME, and CALDAV_PASSWORD.")

    if not args.uid and not args.find:
        sys.exit("Provide --uid <uid> or --find <text> to identify the event.")

    cal_path = _caldav_calendar_path(caldav)

    # ── Discover event ────────────────────────────────────────
    print("Searching for event …")

    if args.uid:
        ev = caldav.get_event_by_uid(cal_path, args.uid)
        if not ev:
            sys.exit(f"No event found with UID: {args.uid}")
        events = [ev]
    else:
        # Text search: fetch all events and filter client-side
        all_events = caldav.get_calendar_events(cal_path)
        needle = args.find.lower()
        events = [
            e for e in all_events
            if needle in e.get("summary", "").lower()
            or needle in e.get("description", "").lower()
        ]
        if not events:
            sys.exit(f"No event found matching: {args.find!r}")
        if len(events) > 1 and not args.force:
            print(f"Found {len(events)} matching events:")
            for ev in events:
                print(f"  uid={ev.get('uid')}  title={ev.get('summary')!r}"
                      f"  start={ev.get('dtstart')}")
            sys.exit(
                "Multiple events found. Re-run with --uid <uid> to target a specific one,\n"
                "or pass --force to update all matching events."
            )

    # ── Build iCal patches ────────────────────────────────────
    ical_patches: dict[str, str | None] = {}

    if args.new_title:
        ical_patches["SUMMARY"] = args.new_title

    if args.new_description:
        ical_patches["DESCRIPTION"] = args.new_description

    if args.new_location:
        ical_patches["LOCATION"] = args.new_location

    if args.new_start:
        try:
            new_start = datetime.fromisoformat(args.new_start)
        except ValueError:
            sys.exit(f"Invalid --new-start: {args.new_start!r}")
        ical_patches["DTSTART"] = new_start.strftime("%Y%m%dT%H%M%S")

    if args.new_duration:
        mins = duration_to_minutes(args.new_duration)
        if args.new_start:
            new_end = datetime.fromisoformat(args.new_start) + timedelta(minutes=mins)
        elif events:
            dtstart_str = events[0].get("dtstart", "")
            try:
                existing_start = datetime.fromisoformat(dtstart_str)
            except ValueError:
                existing_start = datetime.now()
            new_end = existing_start + timedelta(minutes=mins)
        else:
            new_end = datetime.now() + timedelta(minutes=mins)
        ical_patches["DTEND"] = new_end.strftime("%Y%m%dT%H%M%S")

    if args.status:
        ical_patches["STATUS"] = args.status.upper()

    if not ical_patches and not args.add_attendee and not args.remove_attendee:
        sys.exit("No changes specified. Provide at least one --new-* / --add-attendee / --status.")

    # ── Apply patches via CalDAV PUT ──────────────────────────
    updated_count = 0
    for ev in events:
        href = ev.get("href")
        etag = ev.get("etag")
        ical = ev.get("ical", "")
        if not href or not ical:
            print(f"  ⚠ Skipping event (no href/ical data): {ev.get('summary')}", file=sys.stderr)
            continue

        # Apply property patches
        updated_ical = update_ical_vevent(ical, **ical_patches) if ical_patches else ical

        # Handle attendee add/remove by editing ATTENDEE lines directly
        if args.add_attendee:
            for email in args.add_attendee:
                attendee_line = f"ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:{email}"
                updated_ical = updated_ical.replace(
                    "END:VEVENT",
                    f"{attendee_line}\r\nEND:VEVENT",
                )

        if args.remove_attendee:
            for email in args.remove_attendee:
                # Remove any ATTENDEE line containing this email
                lines = updated_ical.split("\r\n")
                lines = [l for l in lines if f"mailto:{email}" not in l.lower()]
                updated_ical = "\r\n".join(lines)

        # Bump SEQUENCE
        seq_match = re.search(r"SEQUENCE:(\d+)", updated_ical)
        if seq_match:
            new_seq = int(seq_match.group(1)) + 1
            updated_ical = updated_ical.replace(
                seq_match.group(0), f"SEQUENCE:{new_seq}"
            )

        print(f"Updating event uid={ev.get('uid')}  title={ev.get('summary')!r} …")
        caldav.update_event(href, updated_ical, etag=etag)
        updated_count += 1

        # Send updated iMIP invites to attendees
        attendees = ev.get("attendees", [])
        attendee_emails = [a["email"] for a in attendees if a.get("email")]
        if args.add_attendee:
            attendee_emails.extend(args.add_attendee)
        if args.remove_attendee:
            remove_set = {e.lower() for e in args.remove_attendee}
            attendee_emails = [e for e in attendee_emails if e.lower() not in remove_set]

        if attendee_emails and not args.no_notify:
            print("  Sending updated iMIP invites …")
            msg = MIMEMultipart("alternative")
            msg["From"] = FROM_ADDR
            msg["To"] = ", ".join(attendee_emails)
            msg["Subject"] = ical_patches.get("SUMMARY", ev.get("summary", "Meeting Update"))
            msg.attach(MIMEText("Meeting updated.", "plain", "utf-8"))
            cal_part = MIMEText(updated_ical, "calendar", "utf-8")
            cal_part.set_param("method", "REQUEST")
            msg.attach(cal_part)
            upload_and_submit(token, msg, attendee_emails)

    print(f"✓ Updated {updated_count} event(s).")
    for k, v in ical_patches.items():
        if v is not None:
            print(f"  {k}: {v}")
    if args.add_attendee:
        print(f"  Added attendees: {', '.join(args.add_attendee)}")
    if args.remove_attendee:
        print(f"  Removed attendees: {', '.join(args.remove_attendee)}")
    if not args.no_notify:
        print("  Attendees notified of changes via iMIP.")


# ── cmd: query-events ─────────────────────────────────────────────────────────

_PARTSTAT_ICON = {
    "accepted":     "✓",
    "declined":     "✗",
    "tentative":    "?",
    "needs-action": "·",
    "delegated":    "→",
}


def _format_time_12h(raw: str) -> str:
    """Convert an iCal datetime string like '20260306T150000' to '3:00 PM'."""
    for fmt in ("%Y%m%dT%H%M%S", "%Y%m%dT%H%M%SZ", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            dt = datetime.strptime(raw, fmt)
            return dt.strftime("%a %b %d %I:%M %p").replace(" 0", " ")
        except ValueError:
            continue
    return raw


def _format_event_block(
    title: str,
    dtstart: str,
    dtend: str,
    duration: str,
    location: str,
    uid: str,
    attendees: list[dict],
    backend: str = "",
) -> str:
    """Format a single event as a human-readable text block."""
    lines: list[str] = [f"📅 {title}"]
    start_fmt = _format_time_12h(dtstart)
    if dtend:
        end_fmt = _format_time_12h(dtend)
        # If same day, only show time for end
        if start_fmt.split(" ")[:-2] == end_fmt.split(" ")[:-2]:
            end_short = datetime.strptime(dtend, "%Y%m%dT%H%M%S").strftime("%I:%M %p").lstrip("0") \
                if len(dtend) == 15 else end_fmt
            time_part = f"{start_fmt}–{end_short}"
        else:
            time_part = f"{start_fmt} – {end_fmt}"
    elif duration:
        time_part = f"{start_fmt} ({duration})"
    else:
        time_part = start_fmt
    lines.append(f"   Date:     {time_part}")
    if location:
        lines.append(f"   Location: {location}")
    if uid:
        lines.append(f"   UID:      {uid}")
    if backend:
        lines.append(f"   Backend:  {backend}")
    if attendees:
        lines.append("   Attendees:")
        for att in attendees:
            icon  = _PARTSTAT_ICON.get(att.get("partstat", "").lower(), "·")
            label = att.get("name") or att.get("email", "?")
            stat  = att.get("partstat", "needs-action")
            lines.append(f"     {icon} {label} <{att.get('email', '')}> ({stat})")
    return "\n".join(lines)


def cmd_query_events(args) -> None:
    """Search calendar events by date range / text / UID and display RSVP status.

    Data sources (tried in order):
      1. CalDAV — if CALDAV_URL / CALDAV_USERNAME / CALDAV_PASSWORD are set.
         Events are read from the CalDAV server; RSVP state is refreshed from
         attendee PARTSTATs in the iCalendar data.
      2. JMAP Calendar — if the account has the calendars capability.
      3. Local RSVP state file — always consulted as a supplementary source to
         show attendee responses tracked from previous meeting invites.

    Exits with an error if no calendar backend is available.
    """
    token = get_token()

    # ── Parse date filters ────────────────────────────────────
    after: datetime | None = None
    before: datetime | None = None
    if args.after:
        try:
            after = datetime.fromisoformat(args.after).replace(tzinfo=timezone.utc)
        except ValueError:
            sys.exit(f"Invalid --after: {args.after!r} (use ISO format, e.g. 2026-03-01)")
    if args.before:
        try:
            before = datetime.fromisoformat(args.before).replace(tzinfo=timezone.utc)
        except ValueError:
            sys.exit(f"Invalid --before: {args.before!r} (use ISO format, e.g. 2026-04-01)")

    found_any = False

    # ── 1. CalDAV query ───────────────────────────────────────
    caldav = get_caldav_client()
    if caldav is not None:
        print("Querying CalDAV …")
        try:
            cal_path = _caldav_calendar_path(caldav)
            if args.uid:
                ev = caldav.get_event_by_uid(cal_path, args.uid)
                raw_events = [ev] if ev else []
            else:
                raw_events = caldav.get_calendar_events(cal_path, start=after, end=before)

            # Apply client-side text / attendee filters
            events: list[dict] = []
            for ev in raw_events:
                if args.text:
                    needle = args.text.lower()
                    if needle not in ev.get("summary", "").lower() \
                            and needle not in ev.get("description", "").lower():
                        continue
                if args.attendee:
                    emails = {a.get("email", "").lower() for a in ev.get("attendees", [])}
                    if args.attendee.lower() not in emails:
                        continue
                events.append(ev)

            for ev in events:
                found_any = True
                # Refresh RSVP state from CalDAV data
                uid_val = ev.get("uid", "")
                if uid_val:
                    rsvp_update_from_ical(uid_val, ev.get("attendees", []))
                print(_format_event_block(
                    title=ev.get("summary", "(no title)"),
                    dtstart=ev.get("dtstart", ""),
                    dtend=ev.get("dtend", ""),
                    duration=ev.get("duration", ""),
                    location=ev.get("location", ""),
                    uid=uid_val,
                    attendees=ev.get("attendees", []),
                    backend="caldav",
                ))
                print()
        except CalDAVError as exc:
            print(f"⚠ CalDAV query failed: {exc}", file=sys.stderr)

    # ── 2. JMAP Calendar query ────────────────────────────────
    elif check_calendar_capability(token):
        print("Querying JMAP Calendar …")
        ids = calendar_event_query(
            token,
            uid=args.uid or None,
            text=args.text or None,
            after=after,
            before=before,
        )
        if ids:
            jmap_events = calendar_event_get(token, ids)
            for ev in jmap_events:
                if args.attendee:
                    emails = {
                        p.get("email", "").lower()
                        for p in ev.get("participants", {}).values()
                    }
                    if args.attendee.lower() not in emails:
                        continue
                found_any = True
                # Normalise JMAP participants into attendee dicts for display
                attendees = [
                    {
                        "email":    p.get("email", ""),
                        "name":     p.get("name", ""),
                        "partstat": p.get("participationStatus", "needs-action"),
                        "rsvp":     p.get("expectReply", False),
                    }
                    for p in ev.get("participants", {}).values()
                ]
                uid_val = ev.get("uid", "")
                if uid_val:
                    rsvp_update_from_ical(uid_val, attendees)
                print(_format_event_block(
                    title=ev.get("title", "(no title)"),
                    dtstart=ev.get("start", ""),
                    dtend="",
                    duration=ev.get("duration", ""),
                    location=next(
                        (loc.get("name", "") for loc in ev.get("locations", {}).values()), ""
                    ),
                    uid=uid_val,
                    attendees=attendees,
                    backend="jmap",
                ))
                print()
    else:
        # ── 3. Local RSVP state only ──────────────────────────────────
        state = load_rsvp_state()
        if not state:
            sys.exit(
                "No calendar backend available (JMAP Calendar not enabled, "
                "CALDAV_* vars not set) and no local RSVP state found."
            )
        print("No live calendar backend available — showing local RSVP state …\n")
        for uid_key, rec in state.items():
            if args.uid and uid_key != args.uid:
                continue
            if args.text:
                needle = args.text.lower()
                if needle not in rec.get("title", "").lower():
                    continue
            if args.attendee:
                if args.attendee.lower() not in {e.lower() for e in rec.get("attendees", {})}:
                    continue
            found_any = True
            attendee_list = [
                {
                    "email":    email,
                    "name":     info.get("name", ""),
                    "partstat": info.get("partstat", "needs-action"),
                }
                for email, info in rec.get("attendees", {}).items()
            ]
            print(_format_event_block(
                title=rec.get("title", "(no title)"),
                dtstart=rec.get("start", ""),
                dtend="",
                duration="",
                location="",
                uid=uid_key,
                attendees=attendee_list,
                backend=rec.get("backend", ""),
            ))
            print()

    if not found_any:
        print("No events found matching the specified filters.")


# ── CLI ───────────────────────────────────────────────────────────────────────

def main() -> None:
    global ACCOUNT_ID, IDENTITY_ID, DRAFTS_ID, SENT_ID
    global CALDAV_URL, CALDAV_USERNAME, CALDAV_CALENDAR_PATH, CALENDAR_ID
    global UPLOAD_URL

    p = argparse.ArgumentParser(
        prog="fastmail",
        description="Send emails and manage calendar events via Fastmail JMAP.",
    )
    p.add_argument("--account-id", required=True, help="JMAP account ID")
    p.add_argument("--identity-id", required=True, help="EmailIdentity ID for submission")
    p.add_argument("--drafts-id", required=True, help="Drafts mailbox ID")
    p.add_argument("--sent-id", required=True, help="Sent mailbox ID")
    p.add_argument("--caldav-url", default="", help="CalDAV server base URL")
    p.add_argument("--caldav-username", default="", help="CalDAV username")
    p.add_argument("--caldav-calendar-path", default="", help="CalDAV calendar collection path")
    p.add_argument("--calendar-id", default="", help="JMAP Calendar ID (optional)")
    sub = p.add_subparsers(dest="cmd", required=True)

    # ── send ──────────────────────────────────────────────────
    s = sub.add_parser("send", help="Send a plain-text email")
    s.add_argument("--to",          nargs="+", required=True, metavar="ADDR",
                   help="One or more recipient addresses")
    s.add_argument("--cc",          nargs="+", metavar="ADDR")
    s.add_argument("--subject", "-s", required=True)
    s.add_argument("--body",    "-b", required=True)
    s.add_argument("--signature",   help="Signature block appended after a blank line")
    s.add_argument("--attachment", "-a", nargs="+", metavar="FILE",
                   help="File path(s) to attach")

    # ── meeting ───────────────────────────────────────────────
    m = sub.add_parser("meeting", help="Send a calendar meeting invite")
    m.add_argument("--to",          nargs="+", required=True, metavar="ADDR")
    m.add_argument("--cc",          nargs="+", metavar="ADDR")
    m.add_argument("--subject", "-s", required=True)
    m.add_argument("--start",       required=True,
                   help="ISO datetime, e.g. 2026-03-15T14:00")
    m.add_argument("--duration", "-d", default="1h",
                   help="Duration: '1h', '30m', '1.5h' (default: 1h)")
    m.add_argument("--location", "-l")
    m.add_argument("--description",
                   help="Plain-text body / agenda (also used as iCal DESCRIPTION)")
    m.add_argument("--timezone",    default="America/Los_Angeles",
                   help="IANA timezone (default: America/Los_Angeles)")
    m.add_argument("--signature",   help="Signature block for the email body")

    # ── update-event ──────────────────────────────────────────
    u = sub.add_parser("update-event",
                       help="Find a calendar event by UID or subject and modify it")
    u.add_argument("--uid",          help="Exact event UID to target")
    u.add_argument("--find",         metavar="TEXT",
                   help="Free-text search across event title/description")
    u.add_argument("--new-title",    metavar="TEXT", help="Replace the event title")
    u.add_argument("--new-start",    metavar="DATETIME",
                   help="New start time (ISO format, e.g. 2026-03-15T14:00)")
    u.add_argument("--new-duration", metavar="DURATION",
                   help="New duration (e.g. '1h', '30m')")
    u.add_argument("--new-location", metavar="TEXT")
    u.add_argument("--new-description", metavar="TEXT")
    u.add_argument("--timezone",     default="America/Los_Angeles",
                   help="Timezone for interpreting --new-start (default: America/Los_Angeles)")
    u.add_argument("--status",       choices=["confirmed", "tentative", "cancelled"],
                   help="Update event status")
    u.add_argument("--add-attendee",    nargs="+", metavar="ADDR",
                   help="Email address(es) to add as attendees")
    u.add_argument("--remove-attendee", nargs="+", metavar="ADDR",
                   help="Email address(es) to remove from attendees")
    u.add_argument("--no-notify",    action="store_true",
                   help="Do NOT send update notifications to attendees")
    u.add_argument("--force",        action="store_true",
                   help="Apply update to ALL matching events when multiple are found")

    # ── query-events ──────────────────────────────────────────
    q = sub.add_parser(
        "query-events",
        help="Search calendar events by date/text/UID; shows attendee RSVP status",
    )
    q.add_argument("--after",    metavar="DATE",
                   help="Only show events starting at or after this date (ISO, e.g. 2026-03-01)")
    q.add_argument("--before",   metavar="DATE",
                   help="Only show events starting before this date (ISO, e.g. 2026-04-01)")
    q.add_argument("--text",     metavar="QUERY",
                   help="Filter by text match against event title / description")
    q.add_argument("--attendee", metavar="EMAIL",
                   help="Filter to events that include this attendee email address")
    q.add_argument("--uid",      metavar="UID",
                   help="Return the single event with this exact UID")

    args = p.parse_args()

    # Populate globals from CLI args
    ACCOUNT_ID  = args.account_id
    IDENTITY_ID = args.identity_id
    DRAFTS_ID   = args.drafts_id
    SENT_ID     = args.sent_id
    CALDAV_URL           = args.caldav_url
    CALDAV_USERNAME      = args.caldav_username
    CALDAV_CALENDAR_PATH = args.caldav_calendar_path
    CALENDAR_ID          = args.calendar_id
    UPLOAD_URL  = f"https://api.fastmail.com/jmap/upload/{ACCOUNT_ID}/"

    dispatch = {
        "send":          cmd_send,
        "meeting":       cmd_meeting,
        "update-event":  cmd_update_event,
        "query-events":  cmd_query_events,
    }
    dispatch[args.cmd](args)


if __name__ == "__main__":
    main()
