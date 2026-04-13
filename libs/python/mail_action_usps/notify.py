#!/usr/bin/env python3
"""
Notification routing for USPS mail alerts.

Routes notifications to different recipients based on the addressee:
  - Nicole / Eastside Improv → Nicole's target
  - Jeff / Jeffrey / Steinbok / default → Jeff's target

Config lives at ~/.openclaw/agents/mail/workspace/usps-mail/config.json.
Notifications are planned first, then optionally delivered via `openclaw message send`.
"""

import json
import os
import subprocess
import sys

from .paths import get_config_file

# Addressee patterns → routing key (matched case-insensitively)
_NICOLE_PATTERNS = {"nicole", "eastside improv"}


def load_config(workspace_agent: str = None) -> dict:
    """Load plugin config (routing, etc.)."""
    if not workspace_agent:
        raise ValueError("workspace_agent is required")
    config_file = get_config_file(workspace_agent)
    if config_file.exists():
        with open(config_file) as f:
            return json.load(f)
    return {}


def _classify_recipient(addressee: str) -> str:
    """Determine routing key from addressee name."""
    low = (addressee or "").lower()

    for pat in _NICOLE_PATTERNS:
        if pat in low:
            # Joint mail ("Jeffrey & Nicole") → jeff
            if any(p in low for p in ("jeff", "jeffrey")):
                return "jeff"
            return "nicole"

    return "jeff"


def send_message(message: str, channel: str, target: str) -> bool:
    """Send a notification via openclaw message send."""
    if not target:
        print(f"[NOTIFY] no target: {message}", file=sys.stderr)
        return False

    try:
        result = subprocess.run(
            ["openclaw", "message", "send",
             "--channel", channel, "--target", target,
             "--message", message],
            timeout=30, capture_output=True, text=True,
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        print(f"[NOTIFY] send failed: {message[:100]}", file=sys.stderr)
        return False


def build_notification_plan(date_str: str, items: list, config: dict | None = None, workspace_agent: str = None) -> list:
    """Build per-recipient USPS notification payloads without sending them."""
    if not config and not workspace_agent:
        raise ValueError("workspace_agent is required when config is not provided")
    config = config or load_config(workspace_agent)
    routing = config.get("routing", {})
    default_channel = "discord"

    if not routing:
        # Fallback: use env vars
        routing = {
            "default": {
                "channel": os.environ.get("NOTIFY_CHANNEL", "discord"),
                "target": os.environ.get("NOTIFY_TARGET", ""),
            }
        }

    # Bucket items by recipient
    buckets = {}
    for item in items:
        key = _classify_recipient(item.get("addressee", ""))
        buckets.setdefault(key, []).append(item)

    results = []
    other_items = [it for it in items if it.get("importance") in ("low", "junk", "ad", "medium")]

    for key, key_items in buckets.items():
        dest = routing.get(key) or routing.get("default")
        if not dest:
            continue

        notify_items = [it for it in key_items if it.get("importance") in ("urgent", "high")]
        if not notify_items:
            continue

        lines = [f"📬 USPS Mail ({date_str}) — {len(notify_items)} important for you:"]
        for item in notify_items:
            sender = item.get("sender", "Unknown")
            desc = item.get("description", "")
            imp = item.get("importance", "").upper()
            line = f"  🔴 [{imp}] {sender}"
            if desc:
                line += f": {desc}"
            lines.append(line)

        # Junk/routine summary for Jeff only
        if key != "nicole" and other_items:
            junk = sum(1 for it in other_items if it.get("importance") in ("junk", "ad"))
            rest = len(other_items) - junk
            parts = []
            if rest:
                parts.append(f"{rest} routine")
            if junk:
                parts.append(f"{junk} junk")
            if parts:
                lines.append(f"  Also: {', '.join(parts)}")

        msg = "\n".join(lines)
        channel = dest.get("channel", default_channel)
        target = dest.get("target", "")
        results.append({
            "recipient": key,
            "target": target,
            "channel": channel,
            "message": msg,
            "items": notify_items,
        })

    return results


def route_and_notify(date_str: str, items: list, dry_run: bool = False, workspace_agent: str = None) -> list:
    """
    Route important items to the right recipients and send notifications.

    Returns list of dicts: [{recipient, message, sent}]
    """
    if not workspace_agent:
        raise ValueError("workspace_agent is required")
    plan = build_notification_plan(date_str, items, workspace_agent=workspace_agent)
    results = []
    for entry in plan:
        sent = False
        if dry_run:
            print(f"[DRY RUN → {entry['recipient']}/{entry['target']}]\n{entry['message']}\n", file=sys.stderr)
        else:
            sent = send_message(entry["message"], entry["channel"], entry["target"])

        results.append({**entry, "sent": sent})

    return results
