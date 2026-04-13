#!/usr/bin/env python3
"""Plugin dispatch wrapper for the Outlook work calendar fetcher."""

import json
import os
import sys
from datetime import datetime, timedelta

from fetch_calendar import fetch_calendar, extract_events, format_event

TOOLS = {
    "outlook_work_calendar_fetch": {
        "description": (
            "Fetch upcoming events from the published Outlook work calendar. "
            "Uses the EWS JSON API — no authentication required. "
            "Requires the OUTLOOK_WORK_CALENDAR_URL and OUTLOOK_WORK_FOLDER_ID environment variables."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "days": {
                    "type": "integer",
                    "description": "Number of days ahead to fetch (default 7)",
                    "default": 7,
                }
            },
            "additionalProperties": False,
        },
        "handler": None,  # assigned below
    }
}


def handle_fetch(args):
    days = args.get("days", 7)
    start_dt = datetime.now()
    end_dt = start_dt + timedelta(days=days)
    start_str = start_dt.strftime("%Y-%m-%d")
    end_str = end_dt.strftime("%Y-%m-%d")

    missing = [
        name
        for name in ("OUTLOOK_WORK_CALENDAR_URL", "OUTLOOK_WORK_FOLDER_ID")
        if not os.environ.get(name)
    ]
    if missing:
        return {"error": f"Missing environment variable(s): {', '.join(missing)}"}

    try:
        response = fetch_calendar(start_str, end_str)
    except SystemExit:
        return {"error": "Failed to fetch the published Outlook work calendar"}

    events = extract_events(response)

    formatted = f"## Work Calendar — {len(events)} event(s)  ({start_str} to {end_str})\n"
    for event in events:
        formatted += format_event(event)

    return {"text": formatted, "event_count": len(events), "events": events}


TOOLS["outlook_work_calendar_fetch"]["handler"] = handle_fetch


# ── dispatch ────────────────────────────────────────────────────────────────

def manifest():
    return {
        "tools": [
            {
                "name": name,
                "description": t["description"],
                "input_schema": t["input_schema"],
            }
            for name, t in TOOLS.items()
        ]
    }


def call(tool, args):
    return TOOLS[tool]["handler"](args)


def main():
    payload = json.load(sys.stdin)
    if payload["method"] == "manifest":
        print(json.dumps(manifest()))
    elif payload["method"] == "call":
        print(json.dumps(call(payload["tool"], payload["args"])))


if __name__ == "__main__":
    main()
