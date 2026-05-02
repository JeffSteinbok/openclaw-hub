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
                "calendar_id": {
                    "type": "string",
                    "description": "Configured calendar id from plugin config",
                },
                "url": {
                    "type": "string",
                    "description": "Direct ICS URL override for one-off fetches",
                },
                "label": {
                    "type": "string",
                    "description": "Optional display label when using a direct URL override",
                },
            },
            "additionalProperties": False,
        },
        "handler": None,
    },
}


def _configured_calendars(plugin_config):
    if not isinstance(plugin_config, dict):
        return {}

    raw_calendars = plugin_config.get("calendars")
    if not isinstance(raw_calendars, list):
        return {}

    calendars = {}
    for raw_calendar in raw_calendars:
        if not isinstance(raw_calendar, dict):
            continue
        calendar_id = raw_calendar.get("id")
        url = raw_calendar.get("url")
        if not isinstance(calendar_id, str) or not calendar_id.strip():
            continue
        if not isinstance(url, str) or not url.strip():
            continue
        label = raw_calendar.get("label")
        calendars[calendar_id.strip()] = {
            "url": url.strip(),
            "label": label.strip() if isinstance(label, str) and label.strip() else None,
        }
    return calendars


def _title_case_calendar_id(calendar_id):
    return calendar_id.replace("_", " ").replace("-", " ").title()


def handle_fetch(args, plugin_config=None):
    days = args.get("days", 7)
    url = args.get("url")
    label = args.get("label")
    calendar_id = args.get("calendar_id")

    start_dt = datetime.now()
    end_dt = start_dt + timedelta(days=days)
    start_str = start_dt.strftime("%Y-%m-%d")
    end_str = end_dt.strftime("%Y-%m-%d")

    if url:
        url = url.strip()
        if not url:
            return {"error": "url must not be empty"}
        if not label:
            label = "ICS Feed"
        source_name = "direct url"
    else:
        if not isinstance(calendar_id, str) or not calendar_id.strip():
            return {"error": "calendar_id is required unless url is provided"}
        calendar_id = calendar_id.strip()
        calendar = _configured_calendars(plugin_config).get(calendar_id)
        if not calendar:
            return {"error": f"Unknown calendar_id '{calendar_id}'"}
        url = calendar["url"]
        label = calendar.get("label") or _title_case_calendar_id(calendar_id)
        source_name = f"calendar_id '{calendar_id}'"

    ics = fetch_ics(url)
    if not ics:
        return {"error": f"Could not fetch ICS feed ({source_name})"}

    events = parse_events(ics, start_dt, end_dt)

    formatted = f"## {label} Calendar — {len(events)} event(s)  ({start_str} to {end_str})\n\n"
    for e in events:
        subject = e.get("SUMMARY", "No subject")
        start = e.get("DTSTART", "Unknown")
        end = e.get("DTEND", "Unknown")
        loc = e.get("LOCATION", "No location")
        formatted += f"  📅 {subject}\n     Time: {start} → {end}\n     Location: {loc}\n\n"

    result = {"text": formatted, "event_count": len(events), "events": events}
    if calendar_id:
        result["calendar_id"] = calendar_id
    return result


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


def call(tool, args, plugin_config=None):
    return TOOLS[tool]["handler"](args, plugin_config)


def main():
    payload = json.load(sys.stdin)
    if payload["method"] == "manifest":
        print(json.dumps(manifest()))
    elif payload["method"] == "call":
        print(json.dumps(call(payload["tool"], payload["args"], payload.get("plugin_config"))))


if __name__ == "__main__":
    main()
