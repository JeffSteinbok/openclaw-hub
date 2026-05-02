#!/usr/bin/env python3
"""FastMail plugin tools — JSON stdin/stdout dispatch layer.

Wraps the existing fastmail.py, fastmail_search.py, and caldav_client.py
modules, exposing each command as a tool with a structured dict-in/dict-out
interface for the openclaw-python-framework.

Environment variables (secrets):
  FASTMAIL_JMAP_TOKEN       — API bearer token (required)
  FASTMAIL_CALDAV_PASSWORD  — CalDAV password / app password (for CalDAV ops)

Environment variables (config — replace CLI args):
  FASTMAIL_ACCOUNT_ID       — JMAP account ID
  FASTMAIL_IDENTITY_ID      — EmailIdentity ID for submission
  FASTMAIL_DRAFTS_ID        — Drafts mailbox ID
  FASTMAIL_SENT_ID          — Sent mailbox ID
  FASTMAIL_CALDAV_URL       — CalDAV server base URL
  FASTMAIL_CALDAV_USERNAME  — CalDAV username
  FASTMAIL_CALDAV_CALENDAR_PATH — CalDAV calendar collection path (optional)
"""

import json
import os
import sys
from types import SimpleNamespace

# Ensure sibling modules are importable
sys.path.insert(0, os.path.dirname(__file__))

import fastmail  # noqa: E402
import fastmail_search  # noqa: E402


# ── Helpers ───────────────────────────────────────────────────────────────────

def _configure_fastmail_globals(plugin_config: dict | None = None):
    """Populate fastmail.py module-level globals from plugin_config (preferred) or environment."""
    cfg = plugin_config or {}
    fastmail.ACCOUNT_ID = cfg.get("accountId") or os.environ.get("FASTMAIL_ACCOUNT_ID", "")
    fastmail.IDENTITY_ID = cfg.get("identityId") or os.environ.get("FASTMAIL_IDENTITY_ID", "")
    fastmail.FROM_EMAIL = cfg.get("fromEmail") or os.environ.get("FASTMAIL_FROM_EMAIL", "")
    fastmail.FROM_NAME = cfg.get("fromName") or os.environ.get("FASTMAIL_FROM_NAME", "OpenClaw Assistant")
    fastmail.DRAFTS_ID = cfg.get("draftsId") or os.environ.get("FASTMAIL_DRAFTS_ID", "")
    fastmail.SENT_ID = cfg.get("sentId") or os.environ.get("FASTMAIL_SENT_ID", "")
    fastmail.CALDAV_URL = cfg.get("caldavUrl") or os.environ.get("FASTMAIL_CALDAV_URL", "")
    fastmail.CALDAV_USERNAME = cfg.get("caldavUsername") or os.environ.get("FASTMAIL_CALDAV_USERNAME", "")
    fastmail.CALDAV_PASSWORD = cfg.get("caldavPassword") or os.environ.get("FASTMAIL_CALDAV_PASSWORD", "")
    fastmail.CALDAV_CALENDAR_PATH = cfg.get("caldavCalendarPath") or os.environ.get("FASTMAIL_CALDAV_CALENDAR_PATH", "")
    # Set JMAP token if provided via config
    jmap_token = cfg.get("jmapToken")
    if jmap_token:
        os.environ["FASTMAIL_JMAP_TOKEN"] = jmap_token
    if fastmail.ACCOUNT_ID:
        fastmail.UPLOAD_URL = f"https://api.fastmail.com/jmap/upload/{fastmail.ACCOUNT_ID}/"


def _capture_output(fn, *args, **kwargs):
    """Call *fn* capturing stdout and returning it as a string alongside the return value."""
    import io
    old_stdout = sys.stdout
    sys.stdout = buf = io.StringIO()
    try:
        result = fn(*args, **kwargs)
    finally:
        sys.stdout = old_stdout
    return buf.getvalue(), result


# ── Tool handlers ─────────────────────────────────────────────────────────────

def handle_fastmail_send(args: dict, plugin_config: dict | None = None) -> dict:
    """Send a plain-text email with optional attachments."""
    _configure_fastmail_globals(plugin_config)
    ns = SimpleNamespace(
        to=args["to"] if isinstance(args["to"], list) else [args["to"]],
        cc=args.get("cc") or [],
        subject=args["subject"],
        body=args["body"],
        signature=args.get("signature"),
        attachment=args.get("attachment") or [],
    )
    output, _ = _capture_output(fastmail.cmd_send, ns)
    return {"status": "ok", "output": output.strip()}


def handle_fastmail_search(args: dict, plugin_config: dict | None = None) -> dict:
    """Search emails by keyword, sender, subject, or date range."""
    _configure_fastmail_globals(plugin_config)
    account_id = args.get("account_id") or fastmail.ACCOUNT_ID
    ns = SimpleNamespace(
        account_id=account_id,
        query=args.get("query"),
        sender=args.get("from") or args.get("sender"),
        to=args.get("to"),
        subject=args.get("subject"),
        since=args.get("since"),
        before=args.get("before"),
        limit=args.get("limit", 20),
    )
    output, _ = _capture_output(fastmail_search.cmd_search, ns)
    return {"status": "ok", "output": output.strip()}


def handle_fastmail_read(args: dict, plugin_config: dict | None = None) -> dict:
    """Read a specific email by its JMAP ID."""
    _configure_fastmail_globals(plugin_config)
    account_id = args.get("account_id") or fastmail.ACCOUNT_ID
    ns = SimpleNamespace(
        account_id=account_id,
        id=args["id"],
    )
    output, _ = _capture_output(fastmail_search.cmd_read, ns)
    return {"status": "ok", "output": output.strip()}


def handle_fastmail_inbox(args: dict, plugin_config: dict | None = None) -> dict:
    """Show recent inbox emails, optionally filtered to unread only."""
    _configure_fastmail_globals(plugin_config)
    account_id = args.get("account_id") or fastmail.ACCOUNT_ID
    ns = SimpleNamespace(
        account_id=account_id,
        limit=args.get("limit", 10),
        unread=args.get("unread", False),
    )
    output, _ = _capture_output(fastmail_search.cmd_inbox, ns)
    return {"status": "ok", "output": output.strip()}


def handle_fastmail_meeting(args: dict, plugin_config: dict | None = None) -> dict:
    """Create a calendar meeting invite and send it to attendees via CalDAV + iMIP."""
    _configure_fastmail_globals(plugin_config)
    ns = SimpleNamespace(
        to=args["to"] if isinstance(args["to"], list) else [args["to"]],
        cc=args.get("cc") or [],
        subject=args["subject"],
        start=args["start"],
        duration=args.get("duration", "1h"),
        location=args.get("location"),
        description=args.get("description"),
        timezone=args.get("timezone", "America/Los_Angeles"),
        signature=args.get("signature"),
    )
    output, _ = _capture_output(fastmail.cmd_meeting, ns)
    return {"status": "ok", "output": output.strip()}


def handle_fastmail_update_event(args: dict, plugin_config: dict | None = None) -> dict:
    """Find a calendar event by UID or text search and apply changes."""
    _configure_fastmail_globals(plugin_config)
    ns = SimpleNamespace(
        uid=args.get("uid"),
        find=args.get("find"),
        new_title=args.get("new_title"),
        new_start=args.get("new_start"),
        new_duration=args.get("new_duration"),
        new_location=args.get("new_location"),
        new_description=args.get("new_description"),
        timezone=args.get("timezone", "America/Los_Angeles"),
        status=args.get("status"),
        add_attendee=args.get("add_attendee"),
        remove_attendee=args.get("remove_attendee"),
        force=args.get("force", False),
    )
    output, _ = _capture_output(fastmail.cmd_update_event, ns)
    return {"status": "ok", "output": output.strip()}


def handle_fastmail_query_events(args: dict, plugin_config: dict | None = None) -> dict:
    """Query calendar events by date range, text, attendee, or UID."""
    _configure_fastmail_globals(plugin_config)
    ns = SimpleNamespace(
        after=args.get("after"),
        before=args.get("before"),
        text=args.get("text"),
        attendee=args.get("attendee"),
        uid=args.get("uid"),
    )
    output, _ = _capture_output(fastmail.cmd_query_events, ns)
    return {"status": "ok", "output": output.strip()}


# ── Tool definitions ──────────────────────────────────────────────────────────

TOOLS = {
    "fastmail_send": {
        "description": "Send a plain-text email via Fastmail JMAP, with optional file attachments.",
        "input_schema": {
            "type": "object",
            "required": ["to", "subject", "body"],
            "properties": {
                "to": {
                    "oneOf": [
                        {"type": "string"},
                        {"type": "array", "items": {"type": "string"}}
                    ],
                    "description": "Recipient email address(es)"
                },
                "cc": {
                    "type": "array", "items": {"type": "string"},
                    "description": "CC recipient email address(es)"
                },
                "subject": {"type": "string", "description": "Email subject line"},
                "body": {"type": "string", "description": "Plain-text email body"},
                "signature": {"type": "string", "description": "Signature block appended after body"},
                "attachment": {
                    "type": "array", "items": {"type": "string"},
                    "description": "File path(s) to attach"
                },
            },
        },
        "handler": handle_fastmail_send,
    },
    "fastmail_search": {
        "description": "Search emails in Fastmail inbox by keyword, sender, subject, or date range via JMAP.",
        "input_schema": {
            "type": "object",
            "properties": {
                "account_id": {"type": "string", "description": "JMAP account ID (defaults to FASTMAIL_ACCOUNT_ID env)"},
                "query": {"type": "string", "description": "Full-text search query"},
                "from": {"type": "string", "description": "Filter by sender email or domain"},
                "to": {"type": "string", "description": "Filter by recipient"},
                "subject": {"type": "string", "description": "Filter by subject text"},
                "since": {"type": "string", "description": "Emails after this date (YYYY-MM-DD)"},
                "before": {"type": "string", "description": "Emails before this date (YYYY-MM-DD)"},
                "limit": {"type": "integer", "description": "Max results (default 20)"},
            },
        },
        "handler": handle_fastmail_search,
    },
    "fastmail_read": {
        "description": "Read a specific email by its JMAP email ID, returning full headers and body text.",
        "input_schema": {
            "type": "object",
            "required": ["id"],
            "properties": {
                "account_id": {"type": "string", "description": "JMAP account ID (defaults to FASTMAIL_ACCOUNT_ID env)"},
                "id": {"type": "string", "description": "JMAP email ID to read"},
            },
        },
        "handler": handle_fastmail_read,
    },
    "fastmail_inbox": {
        "description": "Show recent emails from the Fastmail inbox, optionally filtered to unread only.",
        "input_schema": {
            "type": "object",
            "properties": {
                "account_id": {"type": "string", "description": "JMAP account ID (defaults to FASTMAIL_ACCOUNT_ID env)"},
                "limit": {"type": "integer", "description": "Max emails to show (default 10)"},
                "unread": {"type": "boolean", "description": "Only show unread emails"},
            },
        },
        "handler": handle_fastmail_inbox,
    },
    "fastmail_meeting": {
        "description": "Create a calendar meeting invite via CalDAV and send iMIP invitations to attendees.",
        "input_schema": {
            "type": "object",
            "required": ["to", "subject", "start"],
            "properties": {
                "to": {
                    "oneOf": [
                        {"type": "string"},
                        {"type": "array", "items": {"type": "string"}}
                    ],
                    "description": "Attendee email address(es)"
                },
                "cc": {
                    "type": "array", "items": {"type": "string"},
                    "description": "CC recipient email address(es)"
                },
                "subject": {"type": "string", "description": "Meeting title"},
                "start": {"type": "string", "description": "Start datetime in ISO format (e.g. 2026-03-15T14:00)"},
                "duration": {"type": "string", "description": "Duration: '1h', '30m', '1.5h' (default: 1h)"},
                "location": {"type": "string", "description": "Meeting location"},
                "description": {"type": "string", "description": "Meeting description / agenda"},
                "timezone": {"type": "string", "description": "IANA timezone (default: America/Los_Angeles)"},
                "signature": {"type": "string", "description": "Signature block for the invite email"},
            },
        },
        "handler": handle_fastmail_meeting,
    },
    "fastmail_update_event": {
        "description": "Find a calendar event by UID or text search and update its title, time, location, attendees, or status.",
        "input_schema": {
            "type": "object",
            "properties": {
                "uid": {"type": "string", "description": "Exact event UID to target"},
                "find": {"type": "string", "description": "Free-text search across event title/description"},
                "new_title": {"type": "string", "description": "Replace the event title"},
                "new_start": {"type": "string", "description": "New start time (ISO format)"},
                "new_duration": {"type": "string", "description": "New duration (e.g. '1h', '30m')"},
                "new_location": {"type": "string", "description": "Replace location"},
                "new_description": {"type": "string", "description": "Replace description/notes"},
                "timezone": {"type": "string", "description": "Timezone for --new-start (default: America/Los_Angeles)"},
                "status": {"type": "string", "enum": ["confirmed", "tentative", "cancelled"], "description": "Update event status"},
                "add_attendee": {"type": "array", "items": {"type": "string"}, "description": "Email(s) to add as attendees"},
                "remove_attendee": {"type": "array", "items": {"type": "string"}, "description": "Email(s) to remove from attendees"},
                "force": {"type": "boolean", "description": "Update all matching events when multiple found"},
            },
        },
        "handler": handle_fastmail_update_event,
    },
    "fastmail_query_events": {
        "description": "Query calendar events by date range, text, attendee email, or UID. Shows attendee RSVP status.",
        "input_schema": {
            "type": "object",
            "properties": {
                "after": {"type": "string", "description": "Only events starting at or after this date (ISO, e.g. 2026-03-01)"},
                "before": {"type": "string", "description": "Only events starting before this date (ISO, e.g. 2026-04-01)"},
                "text": {"type": "string", "description": "Filter by text match on title/description"},
                "attendee": {"type": "string", "description": "Filter to events including this attendee email"},
                "uid": {"type": "string", "description": "Return the single event with this exact UID"},
            },
        },
        "handler": handle_fastmail_query_events,
    },
}


# ── JSON stdin/stdout dispatch ────────────────────────────────────────────────

def manifest():
    return {
        "tools": [
            {
                "name": k,
                "description": v["description"],
                "input_schema": v["input_schema"],
            }
            for k, v in TOOLS.items()
        ]
    }


def call(tool, args, plugin_config=None):
    if tool not in TOOLS:
        return {"error": f"Unknown tool: {tool}"}
    try:
        return TOOLS[tool]["handler"](args, plugin_config)
    except SystemExit as e:
        return {"error": str(e)}
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}


def main():
    payload = json.load(sys.stdin)
    if payload["method"] == "manifest":
        print(json.dumps(manifest()))
    elif payload["method"] == "call":
        result = call(payload["tool"], payload["args"], payload.get("plugin_config"))
        print(json.dumps(result))
    else:
        print(json.dumps({"error": f"Unknown method: {payload['method']}"}))


if __name__ == "__main__":
    main()
