#!/usr/bin/env python3
"""Fastmail JMAP EventSource daemon.

Connects to Fastmail's SSE stream, detects new Inbox emails,
formats a notification with emoji, and sends it to Telegram via OpenClaw.
Runs as a systemd user service (fastmail-sse.service).
"""

import json, os, sys, subprocess, time, signal
from urllib.request import Request, urlopen

# ── Config ────────────────────────────────────────────────────
JMAP_API    = "https://api.fastmail.com/jmap/api/"
EVENT_URL   = "https://api.fastmail.com/jmap/event/?types=Email,EmailDelivery&closeafter=no&ping=30"
STATE_FILE  = os.path.expanduser("~/.openclaw/services/fastmail-sse-state.json")
RECONNECT_DELAY = 10
EMAIL_PROPS = ["id", "from", "subject"]

def require_env(name):
    """Read a required environment variable or exit with a clear message."""
    val = os.environ.get(name)
    if not val:
        sys.exit(f"ERROR: Required environment variable {name} is not set. "
                 f"Add it to your .env file or systemd service Environment= line.")
    return val

# These are loaded at startup from environment variables.
# Set them in ~/.openclaw/.env or in the systemd service unit.
#   FASTMAIL_ACCOUNT_ID  — your Fastmail JMAP account ID (e.g. "***REDACTED_ACCOUNT***")
#   TELEGRAM_CHAT_ID     — Telegram chat/user ID for notifications
#   FASTMAIL_INBOX_ID    — JMAP mailbox ID for your Inbox (e.g. "P-F")
ACCOUNT_ID      = None
TELEGRAM_TARGET = None
INBOX_ID        = None

def log(msg):
    print(f"[fastmail-sse] {msg}", flush=True)

def get_token():
    """Resolve API token: env var first, then file fallback, else exit."""
    t = os.environ.get("FASTMAIL_JMAP_TOKEN")
    if t: return t
    p = os.path.expanduser("~/.fastmail_token")
    if os.path.exists(p):
        with open(p) as f:
            return f.read().strip()
    sys.exit("FASTMAIL_JMAP_TOKEN not found (checked env + ~/.fastmail_token)")

# ── JMAP ──────────────────────────────────────────────────────
def jmap(token, calls):
    """Make a JMAP API call with the given method calls."""
    body = json.dumps({
        "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
        "methodCalls": calls
    }).encode()
    req = Request(JMAP_API, body, {
        "Authorization": f"Bearer {token}", "Content-Type": "application/json"
    })
    with urlopen(req) as r:
        return json.loads(r.read())

def fetch_new_emails(token, old_state):
    """Email/changes → filter to Inbox only → Email/get metadata."""
    result = jmap(token, [
        ["Email/changes", {"accountId": ACCOUNT_ID, "sinceState": old_state}, "changes"]
    ])
    changes = result["methodResponses"][0][1]
    created = changes.get("created", [])
    if not created:
        return []

    # Get only the ones that landed in Inbox
    result = jmap(token, [
        ["Email/get", {
            "accountId": ACCOUNT_ID,
            "ids": created[:20],  # cap batch size to avoid oversized JMAP requests
            "properties": EMAIL_PROPS + ["mailboxIds"]
        }, "get"]
    ])
    emails = result["methodResponses"][0][1].get("list", [])
    # JMAP mailboxIds is a dict keyed by mailbox ID; check membership via `in`
    return [e for e in emails if INBOX_ID in e.get("mailboxIds", {})]

# ── State persistence ─────────────────────────────────────────
def load_state():
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, ValueError):
            log("warn: corrupt state file, resetting")
    return {}

def save_state(state):
    """Atomic write of state to disk (tmp + rename)."""
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f)
    os.replace(tmp, STATE_FILE)

# ── Format + send notification ────────────────────────────────
NOTIFY_MODE = os.environ.get("NOTIFY_MODE", "agent")  # "agent" or "direct"
NOTIFY_CHANNEL = os.environ.get("NOTIFY_CHANNEL", "telegram")  # delivery channel for agent mode

def format_direct_message(sender_str, sender_email, subject):
    """Format for direct Telegram delivery. Returns string or None to skip."""
    low = (subject or "").lower()
    # Suppress automated/marketing messages that match common opt-out keywords
    if any(k in low for k in ("unsubscribe", "noreply", "no-reply")):
        return None

    # Calendar responses
    for prefix, emoji, verb in [
        ("accepted:", "👍", "accepted"),
        ("declined:", "👎", "declined"),
        ("tentative:", "🤷", "tentative"),
    ]:
        if low.startswith(prefix):
            event = subject[len(prefix):].strip()
            name = sender_str.split("<")[0].strip() or sender_email
            return f"👤 {name} {verb} {emoji}: {event}"

    # General mail
    name = sender_str.split("<")[0].strip() or sender_email
    return f"📧 {name}: {subject}"

def notify_via_agent(sender_str, sender_email, subject):
    """Send a pre-formatted notification through the mail-agent.

    Python handles all triage and formatting. The mail-agent simply
    delivers the message to Telegram. If the agent times out or fails,
    falls back to direct delivery.
    """
    msg = format_direct_message(sender_str, sender_email, subject)
    if msg is None:
        log(f"skipped: {sender_str} — {subject}")
        return

    try:
        result = subprocess.run(
            ["openclaw", "agent",
             "--agent", "mail-agent",
             "--channel", NOTIFY_CHANNEL,
             "--deliver",
             "--message", f"Deliver this email notification exactly as written:\n\n{msg}"],
            timeout=60, capture_output=True, text=True
        )
        if result.returncode != 0:
            log(f"warn: mail-agent returned {result.returncode}: {result.stderr[:200]}")
            notify_direct(sender_str, sender_email, subject)
        else:
            log(f"agent delivered: {msg}")
    except subprocess.TimeoutExpired:
        log(f"warn: mail-agent timed out, falling back to direct")
        notify_direct(sender_str, sender_email, subject)
    except Exception as e:
        log(f"error: mail-agent failed: {e}, falling back to direct")
        notify_direct(sender_str, sender_email, subject)

def notify_direct(sender_str, sender_email, subject):
    """Send a pre-formatted notification directly to Telegram (no AI, no tokens)."""
    msg = format_direct_message(sender_str, sender_email, subject)
    if msg is None:
        log(f"skipped: {sender_str} — {subject}")
        return

    try:
        subprocess.run(
            ["openclaw", "message", "send",
             "--channel", NOTIFY_CHANNEL,
             "--target", TELEGRAM_TARGET,
             "--message", msg],
            timeout=30, capture_output=True
        )
        log(f"sent: {msg}")
    except subprocess.TimeoutExpired:
        log(f"warn: telegram send timed out")
    except Exception as e:
        log(f"error: send failed: {e}")

def notify(email):
    """Route email notification based on NOTIFY_MODE (agent or direct)."""
    # JMAP "from" is a list of {name, email} objects; grab the first or default to {}
    sender = (email.get("from") or [{}])[0] if email.get("from") else {}
    sender_name = sender.get("name", "")
    sender_email = sender.get("email", "unknown")
    sender_str = f"{sender_name} <{sender_email}>" if sender_name else sender_email
    subject = (email.get("subject", "(no subject)") or "(no subject)")[:150]  # truncate long subjects

    if NOTIFY_MODE == "agent":
        notify_via_agent(sender_str, sender_email, subject)
    else:
        notify_direct(sender_str, sender_email, subject)

# ── SSE stream ────────────────────────────────────────────────
def stream(token):
    """Connect to JMAP EventSource, process state change events."""
    req = Request(EVENT_URL, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "text/event-stream"
    })

    state = load_state()
    email_state = state.get("Email")
    log(f"connecting (previous state: {email_state or 'first run'})")

    with urlopen(req, timeout=300) as resp:
        for raw in resp:
            line = raw.decode("utf-8").rstrip("\r\n")

            # Skip SSE protocol lines: blanks, comments (:), event type, and id fields
            if not line or line.startswith(":") or line.startswith("event:") or line.startswith("id:"):
                continue

            if not line.startswith("data:"):
                continue

            try:
                data = json.loads(line[5:].strip())  # strip "data:" prefix
            except json.JSONDecodeError:
                continue

            changed = data.get("changed", {}).get(ACCOUNT_ID, {})
            new_email_state = changed.get("Email")
            if not new_email_state or new_email_state == email_state:
                continue

            # On first run (email_state is None), just record state without fetching
            if email_state is not None:
                log(f"state change: {email_state} → {new_email_state}")
                try:
                    for em in fetch_new_emails(token, email_state):
                        notify(em)
                except Exception as e:
                    log(f"error fetching changes: {e}")
            else:
                log(f"initial state: {new_email_state}")

            email_state = new_email_state
            state["Email"] = email_state
            save_state(state)

# ── Main ──────────────────────────────────────────────────────
def main():
    global ACCOUNT_ID, TELEGRAM_TARGET, INBOX_ID
    ACCOUNT_ID      = require_env("FASTMAIL_ACCOUNT_ID")
    TELEGRAM_TARGET = require_env("TELEGRAM_CHAT_ID")
    INBOX_ID        = require_env("FASTMAIL_INBOX_ID")

    token = get_token()
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))  # graceful systemd stop

    while True:
        try:
            stream(token)
        except KeyboardInterrupt:
            log("shutdown")
            break
        except Exception as e:
            log(f"connection lost: {e} — reconnecting in {RECONNECT_DELAY}s")
            time.sleep(RECONNECT_DELAY)

if __name__ == "__main__":
    main()
