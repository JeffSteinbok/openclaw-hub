"""
Outlook Calendar plugin – JSON stdin/stdout dispatch layer.

Wraps fetch_calendar.py functions as structured tool handlers for the
OpenClaw Python plugin framework.
"""

import json
import sys
import urllib.error

from fetch_calendar import fetch_calendar

# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------

def handle_fetch(args: dict) -> dict:
    """Fetch personal and/or family calendar events."""
    calendar = args.get("calendar", "all")
    days = args.get("days", 7)
    try:
        return fetch_calendar(calendar=calendar, days=days)
    except urllib.error.HTTPError as e:
        return {"error": f"Graph API error {e.code}: {e.read().decode()[:300]}"}
    except RuntimeError as e:
        return {"error": str(e)}


# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------

TOOLS = {
    "outlook_calendar_fetch": {
        "description": "Fetch upcoming events from Outlook personal, family, or combined calendars.",
        "input_schema": {
            "type": "object",
            "properties": {
                "calendar": {
                    "type": "string",
                    "enum": ["personal", "family", "all"],
                    "description": "Which calendar to fetch: personal, family, or all (default: all).",
                },
                "days": {
                    "type": "integer",
                    "description": "Number of days ahead to fetch events for (default: 7).",
                },
            },
        },
        "handler": handle_fetch,
    },
}

# ---------------------------------------------------------------------------
# JSON stdin/stdout dispatch
# ---------------------------------------------------------------------------

def manifest():
    return {
        "tools": [
            {
                "name": name,
                "description": tool["description"],
                "input_schema": tool["input_schema"],
            }
            for name, tool in TOOLS.items()
        ]
    }


def call(tool_name: str, args: dict):
    return TOOLS[tool_name]["handler"](args)


def main():
    payload = json.load(sys.stdin)
    method = payload["method"]

    if method == "manifest":
        print(json.dumps(manifest()))
    elif method == "call":
        print(json.dumps(call(payload["tool"], payload["args"])))
    else:
        print(json.dumps({"error": f"Unknown method: {method}"}))


if __name__ == "__main__":
    main()
