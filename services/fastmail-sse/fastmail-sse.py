#!/usr/bin/env python3
"""Fastmail JMAP EventSource daemon for OpenClaw.

Connects to Fastmail's SSE stream, detects new Inbox emails,
formats a notification, and delivers it via openclaw message send.
Runs as a systemd user service.

Configuration:
    Create ~/.openclaw/services/fastmail-sse-config.json with account labels and
    top-level mail_rules:
    {
      "accounts": {
        "<account-id-1>": {
          "label": "assistant@example.com"
        },
        "<account-id-2>": {
          "label": "personal@example.com"
        }
      },
      "mail_rules": [
        {
          "id": "assistant-detect-tracking",
          "accounts": ["<account-id-1>"],
          "actions": [{"name": "detect_tracking"}],
          "continue": true
        },
        {
          "id": "assistant-notify-meetings",
          "accounts": ["<account-id-1>"],
          "match": {"subject_prefix": ["accepted:", "declined:", "tentative:"]},
          "actions": [{"name": "notify_email"}]
        }
      ]
    }

Required environment variables:
    FASTMAIL_JMAP_TOKEN    — Fastmail API token (or put in ~/.fastmail_token)
    FASTMAIL_INBOX_IDS     — JMAP mailbox ID(s) to monitor (comma-separated; applied to all accounts)
    NOTIFY_TARGET          — Delivery target (e.g. Discord channel)

Optional environment variables:
    NOTIFY_CHANNEL         — Delivery channel (default: "discord")
"""

import json, os, sys, subprocess, time, signal
from email import policy
from email.parser import BytesParser
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen
from typing import Dict, List


def _bootstrap_python_libs() -> None:
    anchor = Path(__file__).resolve()
    for base in anchor.parents:
        vendored_dir = base / "python"
        if vendored_dir.is_dir():
            vendored_str = str(vendored_dir)
            if vendored_str not in sys.path:
                sys.path.insert(0, vendored_str)
            return
    for base in anchor.parents:
        libs_dir = base / "libs" / "python"
        if libs_dir.is_dir() and (base / "package.json").is_file():
            libs_str = str(libs_dir)
            if libs_str not in sys.path:
                sys.path.insert(0, libs_str)
            return


_bootstrap_python_libs()

from repo_paths.bootstrap import bootstrap_repo_paths

BOOTSTRAP_PATHS = bootstrap_repo_paths(__file__)

from mail_runtime import (
    ActionRegistry,
    AttachmentMeta,
    MailEnvelope,
    execute_rules,
)
from mail_action_usps.register import register_usps_actions
from mail_runtime_core.builtin_actions import format_message, register_builtin_actions
from mail_runtime_core.package_tracking import (
    is_delivery_notification,
    load_tracking_client,
    scan_and_add_packages as scan_and_add_packages_from_envelope,
    scan_and_remove_delivered as scan_and_remove_delivered_from_envelope,
)
from mail_runtime_core.result_dispatch import dispatch_results as dispatch_action_results

# ── Config ────────────────────────────────────────────────────
JMAP_API        = "https://api.fastmail.com/jmap/api/"
EVENT_URL       = "https://api.fastmail.com/jmap/event/?types=Email,EmailDelivery&closeafter=no&ping=30"
STATE_FILE      = os.path.expanduser("~/.openclaw/services/fastmail-sse-state.json")
CONFIG_FILE     = os.path.expanduser("~/.openclaw/services/fastmail-sse-config.json")
RECONNECT_DELAY = 10
EMAIL_PROPS     = ["id", "from", "subject", "receivedAt", "textBody", "htmlBody", "bodyValues", "blobId"]

# Loaded at startup from config file
ACCOUNT_CONFIG = {}    # Dict mapping account ID to config (label, etc.)
ACCOUNT_IDS    = []    # List of account IDs to monitor
INBOX_IDS      = []    # List of mailbox IDs to monitor (applied to all accounts)
MAILBOX_NAMES  = {}    # Dict mapping mailbox ID to name (for notifications)
NOTIFY_TARGET  = None
NOTIFY_CHANNEL = None
RUNTIME_CONFIG = {}
PIPELINE_RULES = []
ACTION_REGISTRY = ActionRegistry()
PIPELINE_WORKSPACE = Path(os.path.expanduser("~/.openclaw/services/mail-runtime"))


def require_env(name):
    """Read a required environment variable or exit with a clear message."""
    val = os.environ.get(name)
    if not val:
        sys.exit(f"ERROR: Required environment variable {name} is not set. "
                 f"Add it to your .env file or systemd EnvironmentFile.")
    return val


def log(msg):
    print(f"[fastmail-sse] {msg}", flush=True)


def get_token():
    """Resolve API token: env var first, then file fallback, else exit."""
    t = os.environ.get("FASTMAIL_JMAP_TOKEN")
    if t:
        return t
    p = os.path.expanduser("~/.fastmail_token")
    if os.path.exists(p):
        with open(p) as f:
            return f.read().strip()
    sys.exit("FASTMAIL_JMAP_TOKEN not found (checked env + ~/.fastmail_token)")


def load_runtime_config():
    """Load the full fastmail-sse config document."""
    if not os.path.exists(CONFIG_FILE):
        sys.exit(f"ERROR: Configuration file not found: {CONFIG_FILE}\n"
                 f"Create this file with mail account config. See README for format.")

    try:
        with open(CONFIG_FILE) as f:
            config = json.load(f)
    except (json.JSONDecodeError, ValueError) as e:
        sys.exit(f"ERROR: Invalid JSON in {CONFIG_FILE}: {e}")

    if not config.get("accounts"):
        sys.exit(f"ERROR: No accounts defined in {CONFIG_FILE}")
    if any("rules" in account_cfg for account_cfg in config["accounts"].values()):
        sys.exit(
            f"ERROR: Legacy accounts.*.rules is no longer supported in {CONFIG_FILE}. "
            f"Move those entries into top-level mail_rules. See README for format."
        )

    return config


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


def get_jmap_session(token):
    """Fetch the Fastmail JMAP session document."""
    req = Request(
        "https://api.fastmail.com/jmap/session",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urlopen(req) as r:
        return json.loads(r.read())


class FastmailProviderClient:
    """Provider adapter exposing lazy body and attachment access."""

    def __init__(self, token, logger):
        self.token = token
        self.logger = logger
        self._download_url_template = None

    def fetch_body(self, envelope: MailEnvelope) -> MailEnvelope:
        if envelope.body_text is not None and envelope.body_html is not None:
            return envelope

        result = jmap(self.token, [[
            "Email/get",
            {
                "accountId": envelope.account_id,
                "ids": [envelope.message_id],
                "properties": ["id", "textBody", "htmlBody", "bodyValues", "blobId"],
                "bodyProperties": ["partId", "type"],
                "fetchTextBodyValues": True,
                "fetchHTMLBodyValues": True,
                "maxBodyValueBytes": 50000,
            },
            "get",
        ]])
        emails = result["methodResponses"][0][1].get("list", [])
        if not emails:
            raise RuntimeError(f"Fastmail message not found: {envelope.message_id}")

        raw = dict(envelope.raw)
        raw.update(emails[0])
        return MailEnvelope(
            **{**envelope.__dict__, "body_text": get_email_body_text(raw), "body_html": get_email_body_html(raw), "raw": raw}
        )

    def list_attachments(self, envelope: MailEnvelope) -> list[AttachmentMeta]:
        msg = self._load_mime_message(envelope)
        attachments = []
        for part in msg.walk():
            if part.is_multipart():
                continue
            disposition = part.get_content_disposition()
            content_id = (part.get("Content-ID") or "").strip("<>") or None
            filename = part.get_filename() or (content_id and f"{content_id}.bin")
            if not filename:
                continue
            attachments.append(
                AttachmentMeta(
                    name=filename,
                    content_type=part.get_content_type(),
                    is_inline=disposition == "inline" or bool(content_id),
                    content_id=content_id,
                )
            )
        return attachments

    def download_attachments(
        self,
        envelope: MailEnvelope,
        output_dir: str,
        *,
        content_types: list[str] | None = None,
        inline_only: bool | None = None,
        include_body_html: bool = False,
    ) -> list[str]:
        os.makedirs(output_dir, exist_ok=True)
        msg = self._load_mime_message(envelope)
        saved = []

        html_body = self._extract_html_body(msg)
        if include_body_html and html_body:
            body_path = os.path.join(output_dir, "body.html")
            with open(body_path, "w") as f:
                f.write(html_body)
            saved.append("body.html")

        for part in msg.walk():
            if part.is_multipart():
                continue

            content_type = part.get_content_type()
            disposition = part.get_content_disposition()
            content_id = (part.get("Content-ID") or "").strip("<>") or None
            filename = part.get_filename() or (content_id and f"{content_id}.bin")
            if not filename:
                continue

            is_inline = disposition == "inline" or bool(content_id)
            if inline_only is True and not is_inline:
                continue
            if inline_only is False and is_inline:
                continue
            if content_types and not _content_type_allowed(content_type, content_types):
                continue

            payload = part.get_payload(decode=True)
            if payload is None:
                continue

            dest = os.path.join(output_dir, filename)
            with open(dest, "wb") as f:
                f.write(payload)
            saved.append(filename)

        return saved

    def _load_mime_message(self, envelope: MailEnvelope):
        raw_bytes = self._download_message_blob(envelope)
        return BytesParser(policy=policy.default).parsebytes(raw_bytes)

    def _download_message_blob(self, envelope: MailEnvelope) -> bytes:
        blob_id = envelope.raw.get("blobId")
        if not blob_id:
            result = jmap(self.token, [[
                "Email/get",
                {
                    "accountId": envelope.account_id,
                    "ids": [envelope.message_id],
                    "properties": ["blobId"],
                },
                "blob",
            ]])
            emails = result["methodResponses"][0][1].get("list", [])
            if not emails:
                raise RuntimeError(f"Fastmail message not found: {envelope.message_id}")
            blob_id = emails[0].get("blobId")
        if not blob_id:
            raise RuntimeError(f"Fastmail message has no blobId: {envelope.message_id}")

        template = self._get_download_url_template()
        url = (
            template
            .replace("{accountId}", quote(envelope.account_id, safe=""))
            .replace("{blobId}", quote(blob_id, safe=""))
            .replace("{name}", quote("message.eml", safe=""))
            .replace("{type}", quote("message/rfc822", safe=""))
        )
        req = Request(url, headers={"Authorization": f"Bearer {self.token}"})
        with urlopen(req) as r:
            return r.read()

    def _get_download_url_template(self):
        if self._download_url_template is None:
            session = get_jmap_session(self.token)
            template = session.get("downloadUrl")
            if not template:
                raise RuntimeError("Fastmail JMAP session missing downloadUrl")
            self._download_url_template = template
        return self._download_url_template

    @staticmethod
    def _extract_html_body(msg) -> str:
        for part in msg.walk():
            if part.is_multipart():
                continue
            if part.get_content_type() != "text/html":
                continue
            disposition = part.get_content_disposition()
            if disposition == "attachment":
                continue
            payload = part.get_payload(decode=True)
            if payload is None:
                continue
            charset = part.get_content_charset() or "utf-8"
            return payload.decode(charset, errors="replace")
        return ""


def _content_type_allowed(content_type: str, allowed_types: list[str]) -> bool:
    for allowed in allowed_types:
        if allowed.endswith("/*"):
            if content_type.startswith(allowed[:-1]):
                return True
        elif content_type == allowed:
            return True
    return False


def fetch_new_emails(token, account_id, old_state):
    """Email/changes → filter to monitored mailboxes → Email/get metadata + body."""
    result = jmap(token, [
        ["Email/changes", {"accountId": account_id, "sinceState": old_state}, "changes"]
    ])
    changes = result["methodResponses"][0][1]
    created = changes.get("created", [])
    if not created:
        return []

    # Get email metadata + body for all created emails
    # Request textBody (list of text part IDs) and bodyValues (actual text content)
    result = jmap(token, [
        ["Email/get", {
            "accountId": account_id,
            "ids": created[:20],  # cap batch size to avoid oversized JMAP requests
            "properties": EMAIL_PROPS + ["mailboxIds"],
            "bodyProperties": ["partId", "type"],  # For textBody/htmlBody parts
            "fetchTextBodyValues": True,  # Fetch text body content
            "fetchHTMLBodyValues": True,  # Fetch HTML body for URL extraction
            "maxBodyValueBytes": 50000  # Limit body size to 50KB per email
        }, "get"]
    ])
    emails = result["methodResponses"][0][1].get("list", [])

    # Filter to emails in any of our monitored mailboxes
    monitored = set(INBOX_IDS)
    filtered = []
    for e in emails:
        email_mailboxes = set(e.get("mailboxIds", {}).keys())
        if monitored & email_mailboxes:
            matching_boxes = monitored & email_mailboxes
            e["_matched_mailbox"] = list(matching_boxes)[0]
            e["_account_id"] = account_id
            filtered.append(e)

    return filtered


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


# ── Mark as read ──────────────────────────────────────────────
def mark_as_read(token, account_id, email_ids):
    """Mark emails as read via JMAP Email/set (sets $seen keyword)."""
    if not email_ids:
        return
    updates = {eid: {"keywords/$seen": True} for eid in email_ids}
    try:
        jmap(token, [
            ["Email/set", {"accountId": account_id, "update": updates}, "mark"]
        ])
        log(f"marked {len(email_ids)} email(s) as read")
    except Exception as e:
        log(f"warn: failed to mark as read: {e}")


# ── Email body extraction ─────────────────────────────────────
def get_email_body_text(email: Dict) -> str:
    """Extract text body from email. Returns empty string if not available."""
    # bodyValues is a dict of partId -> {value, isEncodingProblem, isTruncated}
    body_values = email.get("bodyValues", {})
    if not body_values:
        return ""

    # Try to get first text part
    text_body = email.get("textBody", [])
    if text_body and len(text_body) > 0:
        part_id = text_body[0].get("partId", "")
        if part_id in body_values:
            return body_values[part_id].get("value", "")

    # Fallback: use any available body value
    for part_id, part in body_values.items():
        return part.get("value", "")

    return ""


def get_email_body_html(email: Dict) -> str:
    """Extract HTML body from email. Returns empty string if not available."""
    body_values = email.get("bodyValues", {})
    if not body_values:
        return ""

    html_body = email.get("htmlBody", [])
    if html_body and len(html_body) > 0:
        part_id = html_body[0].get("partId", "")
        if part_id in body_values:
            return body_values[part_id].get("value", "")

    return ""


def scan_and_add_packages(email: Dict, account_id: str) -> List[str]:
    """Backward-compatible wrapper around the shared package-tracking helper."""

    envelope = email_to_envelope(email, account_id)
    account_label = ACCOUNT_CONFIG.get(account_id, {}).get("label", account_id[:8])
    return scan_and_add_packages_from_envelope(
        envelope,
        account_label=account_label,
        logger=log,
        tracking_client_loader=load_tracking_client,
    )


def scan_and_remove_delivered(email: Dict, account_id: str) -> List[str]:
    """Backward-compatible wrapper around the shared package-tracking helper."""

    envelope = email_to_envelope(email, account_id)
    return scan_and_remove_delivered_from_envelope(
        envelope,
        logger=log,
        tracking_client_loader=load_tracking_client,
    )


def build_pipeline_rules(config: dict) -> list[dict]:
    """Compile explicit mail_rules in config order."""
    return list(config.get("mail_rules", []))


def email_to_envelope(email: Dict, account_id: str) -> MailEnvelope:
    """Normalize a Fastmail email dict into a provider-agnostic envelope."""
    sender = (email.get("from") or [{}])[0] if email.get("from") else {}
    sender_name = sender.get("name", "")
    sender_email = sender.get("email", "unknown")
    html_body = get_email_body_html(email)
    has_attachments = bool(email.get("blobId") and "cid:" in (html_body or ""))
    return MailEnvelope(
        message_id=email.get("id", ""),
        provider="fastmail",
        account_id=account_id,
        mailbox_id=email.get("_matched_mailbox"),
        sender_name=sender_name,
        sender_email=sender_email,
        subject=(email.get("subject", "(no subject)") or "(no subject)")[:150],
        received_at=email.get("receivedAt"),
        body_text=get_email_body_text(email),
        body_html=html_body,
        has_attachments=has_attachments,
        raw=email,
    )


def _mailbox_prefix(envelope: MailEnvelope, account_id: str | None) -> str:
    account_label = ACCOUNT_CONFIG.get(account_id or "", {}).get("label", account_id[:8] if account_id else None)
    if account_label and len(ACCOUNT_IDS) > 1:
        return f"[{account_label}] "
    if len(INBOX_IDS) > 1 and envelope.mailbox_id:
        mailbox_name = MAILBOX_NAMES.get(envelope.mailbox_id, envelope.mailbox_id[:8])
        return f"[{mailbox_name}] "
    return ""


def register_actions():
    """Register shared built-in actions with Fastmail-specific adapters."""

    register_builtin_actions(
        ACTION_REGISTRY,
        mailbox_prefix_resolver=lambda envelope: _mailbox_prefix(
            envelope, envelope.account_id
        ),
        account_label_resolver=lambda envelope: ACCOUNT_CONFIG.get(
            envelope.account_id, {}
        ).get("label", envelope.account_id[:8]),
        tracking_client_loader=load_tracking_client,
    )
    register_usps_actions(ACTION_REGISTRY)


def handoff_to_agent(agent: str, message: str):
    """Forward structured pipeline output to an OpenClaw agent."""
    try:
        result = subprocess.run(
            [
                "openclaw", "agent", "--agent", agent, "--json",
                "--timeout", "120", "--message", message,
            ],
            timeout=150, capture_output=True, text=True,
        )
        if result.returncode != 0:
            log(f"error: agent handoff failed: {result.stderr[:200]}")
        else:
            log(f"handoff delivered to agent {agent}")
    except subprocess.TimeoutExpired:
        log(f"error: agent handoff timed out for {agent}")
    except Exception as e:
        log(f"error: agent handoff failed: {e}")


def dispatch_results(results):
    """Deliver structured action results through Fastmail side-effect adapters."""

    dispatch_action_results(
        results,
        logger=log,
        handlers={
            "message": lambda payload: deliver(payload["message"]),
            "agent_handoff": lambda payload: handoff_to_agent(
                payload.get("agent", "main"),
                payload["message"],
            ),
        },
    )


def notify(email, account_id=None, token=None):
    """Process a Fastmail email through the shared rule/action pipeline."""
    if account_id is None:
        return

    envelope = email_to_envelope(email, account_id)
    provider = FastmailProviderClient(token or get_token(), log)
    _, results = execute_rules(
        envelope,
        PIPELINE_RULES,
        ACTION_REGISTRY,
        provider,
        workspace=PIPELINE_WORKSPACE,
        logger=log,
        config=RUNTIME_CONFIG,
    )
    dispatch_results(results)


def deliver(msg):
    """Send a plain message via openclaw message send."""
    try:
        result = subprocess.run(
            ["openclaw", "message", "send",
             "--channel", NOTIFY_CHANNEL,
             "--target", NOTIFY_TARGET,
             "--message", msg],
            timeout=30, capture_output=True, text=True
        )
        if result.returncode != 0:
            log(f"error: message send returned {result.returncode}: {result.stderr[:200]}")
        else:
            log(f"delivered: {msg}")
    except subprocess.TimeoutExpired:
        log(f"error: send timed out for: {msg}")
    except Exception as e:
        log(f"error: delivery failed: {e}")


# ── SSE stream ────────────────────────────────────────────────
def stream(token):
    """Connect to JMAP EventSource, process state change events for all accounts."""
    req = Request(EVENT_URL, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "text/event-stream"
    })

    # Per-account email state: { account_id: email_state_string }
    state = load_state()
    email_states = state.get("EmailStates", {})

    # Seed missing accounts from legacy single-account state
    for acct_id in ACCOUNT_IDS:
        if acct_id not in email_states and "Email" in state:
            email_states[acct_id] = state["Email"]

    for acct_id in ACCOUNT_IDS:
        log(f"connecting account {acct_id[:8]} (previous state: {email_states.get(acct_id) or 'first run'})")

    with urlopen(req, timeout=300) as resp:
        for raw in resp:
            line = raw.decode("utf-8").rstrip("\r\n")

            if not line or line.startswith(":") or line.startswith("event:") or line.startswith("id:"):
                continue
            if not line.startswith("data:"):
                continue

            try:
                data = json.loads(line[5:].strip())
            except json.JSONDecodeError:
                continue

            changed = data.get("changed", {})
            state_changed = False

            for acct_id in ACCOUNT_IDS:
                acct_changed = changed.get(acct_id, {})
                new_email_state = acct_changed.get("Email")
                if not new_email_state:
                    continue

                old_state = email_states.get(acct_id)
                if new_email_state == old_state:
                    continue

                if old_state is not None:
                    log(f"state change [{acct_id[:8]}]: {old_state} → {new_email_state}")
                    try:
                        emails = fetch_new_emails(token, acct_id, old_state)
                        for em in emails:
                            notify(em, account_id=acct_id, token=token)
                        mark_as_read(token, acct_id, [em["id"] for em in emails])
                    except Exception as e:
                        log(f"error fetching changes for {acct_id[:8]}: {e}")
                else:
                    log(f"initial state [{acct_id[:8]}]: {new_email_state}")

                email_states[acct_id] = new_email_state
                state_changed = True

            if state_changed:
                state["EmailStates"] = email_states
                save_state(state)


# ── Mailbox discovery ────────────────────────────────────────
def get_mailbox_names(token, account_id):
    """Fetch mailbox names for all monitored mailboxes in an account."""
    try:
        result = jmap(token, [
            ["Mailbox/get", {
                "accountId": account_id,
                "ids": INBOX_IDS,
                "properties": ["name", "id"]
            }, "mbox"]
        ])
        mailboxes = result["methodResponses"][0][1].get("list", [])
        return {mb["id"]: mb.get("name", mb["id"]) for mb in mailboxes}
    except Exception as e:
        log(f"warn: failed to fetch mailbox names for {account_id[:8]}: {e}")
        return {}


# ── Main ──────────────────────────────────────────────────────
def main():
    global ACCOUNT_CONFIG, ACCOUNT_IDS, INBOX_IDS, MAILBOX_NAMES, NOTIFY_TARGET, NOTIFY_CHANNEL, RUNTIME_CONFIG, PIPELINE_RULES

    # Load configuration from JSON file
    RUNTIME_CONFIG = load_runtime_config()
    ACCOUNT_CONFIG = RUNTIME_CONFIG.get("accounts", {})
    if not ACCOUNT_CONFIG:
        sys.exit(f"ERROR: No accounts defined in {CONFIG_FILE}")
    ACCOUNT_IDS = list(ACCOUNT_CONFIG.keys())
    PIPELINE_RULES = build_pipeline_rules(RUNTIME_CONFIG)
    register_actions()

    NOTIFY_TARGET  = require_env("NOTIFY_TARGET")
    NOTIFY_CHANNEL = os.environ.get("NOTIFY_CHANNEL", "discord")

    # Support FASTMAIL_INBOX_IDS (comma-separated) or FASTMAIL_INBOX_ID (legacy single)
    inbox_ids_str = os.environ.get("FASTMAIL_INBOX_IDS")
    if inbox_ids_str:
        INBOX_IDS = [mid.strip() for mid in inbox_ids_str.split(",") if mid.strip()]
    else:
        inbox_id = os.environ.get("FASTMAIL_INBOX_ID")
        if not inbox_id:
            sys.exit("ERROR: FASTMAIL_INBOX_IDS or FASTMAIL_INBOX_ID is not set.")
        INBOX_IDS = [inbox_id.strip()]

    token = get_token()
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))

    # Fetch mailbox names for display
    for acct_id in ACCOUNT_IDS:
        names = get_mailbox_names(token, acct_id)
        MAILBOX_NAMES.update(names)

    # Display startup config
    log(f"config: channel={NOTIFY_CHANNEL}, target={NOTIFY_TARGET[:6]}...")
    log(f"monitoring {len(ACCOUNT_IDS)} account(s):")
    for acct_id in ACCOUNT_IDS:
        cfg = ACCOUNT_CONFIG[acct_id]
        label = cfg.get("label", acct_id[:8])
        log(f"  • {label} ({acct_id[:8]})")
    if PIPELINE_RULES:
        log(f"compiled {len(PIPELINE_RULES)} mail pipeline rule(s)")

    mailbox_info = ", ".join([MAILBOX_NAMES.get(mid, mid[:8]) for mid in INBOX_IDS])
    log(f"monitoring {len(INBOX_IDS)} mailbox(es): {mailbox_info}")

    while True:
        try:
            stream(token)
        except KeyboardInterrupt:
            log("shutdown")
            break
        except Exception as e:
            log(f"connection lost: {e} — reconnecting in {RECONNECT_DELAY}s")
            time.sleep(RECONNECT_DELAY)


register_actions()


if __name__ == "__main__":
    main()
