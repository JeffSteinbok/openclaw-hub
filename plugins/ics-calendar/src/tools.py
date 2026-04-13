#!/usr/bin/env python3
"""Plugin dispatch wrapper for the ICS calendar fetcher."""

import json
import os
import sys
from datetime import datetime, timedelta

from fetch_calendar import fetch_ics, parse_events

TOOLS = {
    "ics_calendar_fetch": {
        "description": "Fetch upcoming events from a published ICS calendar feed.",
        "input_schema": {
            "type": "object",
            "properties": {
                "days": {
                    "type": "integer",
                    "description": "Number of days ahead to fetch (default 7)",
                    "default": 7,
                },
                "url": {
                    "type": "string",
                    "description": "Direct ICS URL to fetch",
                },
                "env_var": {
                    "type": "string",
                    "description": "Environment variable name holding the ICS URL (e.g. CALENDAR_TRIPIT_ICS_URL)",
                },
                "label": {
                    "type": "string",
                    "description": "Display name for this calendar in output (e.g. 'Nicole', 'TripIt', 'Family')",
                },
            },
            "additionalProperties": False,
        },
        "handler": None,
    },
}


def handle_fetch(args):
    days = args.get("days", 7)
    url = args.get("url")
    env_var = args.get("env_var", "CALENDAR_NICOLE_ICS_URL")
    label = args.get("label")

    start_dt = datetime.now()
    end_dt = start_dt + timedelta(days=days)
    start_str = start_dt.strftime("%Y-%m-%d")
    end_str = end_dt.strftime("%Y-%m-%d")

    if not url:
        url = os.environ.get(env_var)
        if not url:
            return {"error": f"{env_var} is not set"}

    if not label:
        if url and args.get("url"):
            label = "ICS Feed"
        else:
            label = env_var.replace("CALENDAR_", "").replace("_ICS_URL", "").replace("_", " ").title()

    ics = fetch_ics(url)
    if not ics:
        source_name = "direct url" if args.get("url") else env_var
        return {"error": f"Could not fetch ICS feed ({source_name})"}

    events = parse_events(ics, start_dt, end_dt)

    formatted = f"## {label} Calendar — {len(events)} event(s)  ({start_str} to {end_str})\n\n"
    for e in events:
        subject = e.get("SUMMARY", "No subject")
        start = e.get("DTSTART", "Unknown")
        end = e.get("DTEND", "Unknown")
        loc = e.get("LOCATION", "No location")
        formatted += f"  📅 {subject}\n     Time: {start} → {end}\n     Location: {loc}\n\n"

    return {"text": formatted, "event_count": len(events), "events": events}


TOOLS["ics_calendar_fetch"]["handler"] = handle_fetch


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
