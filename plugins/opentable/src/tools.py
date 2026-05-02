"""OpenTable plugin tools — look up restaurants and check availability."""

import json
import os
import subprocess
import sys

# Ensure sibling modules are importable
sys.path.insert(0, os.path.dirname(__file__))

from opentable_client import get_restaurant_id, check_availability

# Heartbeat constants
_HEARTBEAT_SLUG = "john-howie-steak-bellevue"

# Module-level config set by call() before dispatching
_plugin_config: dict | None = None


def opentable_lookup(args: dict) -> dict:
    """Look up a restaurant by its OpenTable URL slug to get its numeric ID."""
    slug = args.get("slug", "").strip()
    if not slug:
        return {"error": "slug is required"}
    return get_restaurant_id(slug)


def opentable_availability(args: dict) -> dict:
    """Check available time slots for a restaurant on OpenTable."""
    restaurant_id = args.get("restaurant_id")
    date = args.get("date", "").strip()
    if not restaurant_id or not date:
        return {"error": "restaurant_id and date are required"}

    party_size = args.get("party_size", 2)
    time = args.get("time", "19:00").strip()
    return check_availability(restaurant_id, date, party_size, time, plugin_config=_plugin_config)


def opentable_heartbeat_check(args: dict) -> dict:
    """Run the OpenTable health check — verifies both lookup and availability."""
    from datetime import datetime, timedelta

    # Step 1: verify slug lookup
    lookup = get_restaurant_id(_HEARTBEAT_SLUG)
    if "error" in lookup:
        return _fail(f"Lookup failed: {lookup['error']}", notify=True)

    rid = lookup.get("restaurant_id")
    if not rid:
        return _fail("Lookup returned no restaurant_id", notify=True)

    # Step 2: verify availability query (uses the persisted query hash)
    test_date = (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d")
    avail = check_availability(rid, test_date, party_size=2, time="19:00", plugin_config=_plugin_config)
    if "error" in avail:
        return _fail(f"Availability check failed (hash may be stale): {avail['error']}", notify=True)

    return {"status": "ok", "message": "OpenTable heartbeat passed (lookup + availability)."}


def _fail(error: str, *, notify: bool = False) -> dict:
    """Return a failure result and optionally send a notification."""
    if notify:
        _send_notification(f"\u26a0\ufe0f OpenTable heartbeat FAILED. {error}")
    return {"status": "error", "message": error}


def _send_notification(message: str) -> None:
    """Send an alert via `openclaw message send` using config or env-configured channel."""
    cfg = _plugin_config or {}
    channel = cfg.get("notifyChannel") or os.environ.get("NOTIFY_CHANNEL", "discord")
    target = cfg.get("notifyTarget") or os.environ.get("NOTIFY_TARGET")

    cmd = ["openclaw", "message", "send", "--channel", channel, "--message", message]
    if target:
        cmd.extend(["--target", target])

    try:
        subprocess.run(cmd, capture_output=True, timeout=30)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Standard plugin dispatch
# ---------------------------------------------------------------------------

TOOLS = {
    "opentable_lookup": {
        "description": (
            "Look up an OpenTable restaurant by its URL slug (e.g. 'carbone-new-york' "
            "from opentable.com/r/carbone-new-york) to get its numeric restaurant ID."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "slug": {
                    "type": "string",
                    "description": "Restaurant URL slug from opentable.com/r/<slug>",
                },
            },
            "required": ["slug"],
        },
        "handler": opentable_lookup,
    },
    "opentable_availability": {
        "description": (
            "Check real-time availability for a restaurant on OpenTable. "
            "Returns available time slots with booking URLs."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "restaurant_id": {
                    "type": "integer",
                    "description": "Numeric restaurant ID (from opentable_lookup)",
                },
                "date": {
                    "type": "string",
                    "description": "Date in YYYY-MM-DD format",
                },
                "party_size": {
                    "type": "integer",
                    "description": "Number of guests (default: 2)",
                    "default": 2,
                },
                "time": {
                    "type": "string",
                    "description": "Preferred time in HH:MM format (default: 19:00)",
                    "default": "19:00",
                },
            },
            "required": ["restaurant_id", "date"],
        },
        "handler": opentable_availability,
    },
    "opentable_heartbeat_check": {
        "description": (
            "Check whether the OpenTable integration is healthy. "
            "Verifies both restaurant lookup and availability queries."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
        "handler": opentable_heartbeat_check,
    },
}


def manifest():
    return {
        "tools": [
            {
                "name": name,
                "description": info["description"],
                "input_schema": info["input_schema"],
            }
            for name, info in TOOLS.items()
        ]
    }


def call(tool: str, args: dict, plugin_config: dict | None = None):
    global _plugin_config
    _plugin_config = plugin_config
    return TOOLS[tool]["handler"](args)


def main():
    payload = json.load(sys.stdin)
    method = payload["method"]
    if method == "manifest":
        print(json.dumps(manifest()))
    elif method == "call":
        print(json.dumps(call(payload["tool"], payload.get("args", {}), payload.get("plugin_config"))))


if __name__ == "__main__":
    main()
