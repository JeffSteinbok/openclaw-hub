"""OpenTable plugin tools — look up restaurants and check availability."""

import json
import os
import sys

# Ensure sibling modules are importable
sys.path.insert(0, os.path.dirname(__file__))

from opentable_client import get_restaurant_id, check_availability


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
    return check_availability(restaurant_id, date, party_size, time)


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


def call(tool: str, args: dict):
    return TOOLS[tool]["handler"](args)


def main():
    payload = json.load(sys.stdin)
    method = payload["method"]
    if method == "manifest":
        print(json.dumps(manifest()))
    elif method == "call":
        print(json.dumps(call(payload["tool"], payload.get("args", {}))))


if __name__ == "__main__":
    main()
