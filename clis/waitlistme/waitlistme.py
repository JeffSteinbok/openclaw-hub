#!/usr/bin/env python3
"""waitlistme — Add yourself to a Waitlist.me queue from the command line.

Usage:
    waitlistme add --name "Jeff" --party 2 --location sammamishcafe [--phone "+1..."] [--notes "..."]
    waitlistme status --location sammamishcafe

Locations are identified by their Waitlist.me slug (the part after /w/ in the URL).
The widget ID and place ID for each location are discovered automatically.
"""

import argparse
import json
import re
import sys
import urllib.request
import urllib.parse
import urllib.error


LOCATIONS = {
    "sammamishcafe": {
        "name": "Sammamish Cafe & Spirits",
        "widget_id": "11667180166",
        "place_id": "11670951034",
    },
}

BASE_URL = "https://www.waitlist.me"


def discover_location(slug: str) -> dict:
    """Try to discover widget_id and place_id for an unknown location."""
    # First check hardcoded locations
    if slug in LOCATIONS:
        return LOCATIONS[slug]

    # Try to load the widget page and extract IDs
    url = f"{BASE_URL}/w/{slug}"
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        print(f"Error: Location '{slug}' not found (HTTP {e.code})", file=sys.stderr)
        sys.exit(1)

    # Extract widget ID from the script tag
    wg_match = re.search(r'load_widget_script/\?wg=(\d+)', html)
    if not wg_match:
        print(f"Error: Could not find widget ID for '{slug}'", file=sys.stderr)
        sys.exit(1)

    widget_id = wg_match.group(1)

    # Fetch widget script to get place_id
    script_url = f"{BASE_URL}/load_widget_script/?wg={widget_id}"
    try:
        with urllib.request.urlopen(script_url, timeout=10) as resp:
            script = resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"Error: Could not load widget script: {e}", file=sys.stderr)
        sys.exit(1)

    place_match = re.search(r"place_id=(\d+)", script)
    if not place_match:
        print(f"Error: Could not find place_id for '{slug}'", file=sys.stderr)
        sys.exit(1)

    return {
        "name": slug,
        "widget_id": widget_id,
        "place_id": place_match.group(1),
    }


def cmd_add(args):
    """Add yourself to a waitlist."""
    loc = discover_location(args.location)

    params = {
        "size": str(args.party),
        "name": args.name,
        "phone": args.phone or "",
        "notes": args.notes or "",
        "estimated_arrival_time": "",
        "place_id": loc["place_id"],
        "source": "widget",
    }

    url = f"{BASE_URL}/api/add_party_remotely_widget?{urllib.parse.urlencode(params)}"

    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            body = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        print(f"Error: API returned HTTP {e.code}", file=sys.stderr)
        sys.exit(1)

    # Parse JSONP response: wlme_callResponseInfo({...})
    json_match = re.search(r"wlme_callResponseInfo\((\{.*\})\)", body)
    if not json_match:
        print(f"Error: Unexpected response: {body}", file=sys.stderr)
        sys.exit(1)

    data = json.loads(json_match.group(1).replace("'", '"'))

    if data.get("status") == 0:
        loc_name = loc.get("name", args.location)
        print(f"✓ Added to waitlist at {loc_name}")
        print(f"  Name: {args.name}, Party: {args.party}")
        if args.phone:
            print(f"  Phone: {args.phone} (you'll get a text when ready)")
        print(f"  Request ID: {data.get('party_req_id', 'unknown')}")
    else:
        print(f"✗ Failed: {data.get('msg', 'unknown error')}", file=sys.stderr)
        sys.exit(1)


def cmd_status(args):
    """Check current waitlist status for a location."""
    loc = discover_location(args.location)
    widget_id = loc["widget_id"]

    # Load the widget page to get current status
    script_url = f"{BASE_URL}/load_widget_script/?wg={widget_id}"
    try:
        with urllib.request.urlopen(script_url, timeout=10) as resp:
            script = resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"Error: Could not load status: {e}", file=sys.stderr)
        sys.exit(1)

    # Extract wait info from the widget HTML
    loc_name = loc.get("name", args.location)
    print(f"📋 {loc_name} Waitlist Status")

    # Check for "No one on waitlist"
    if "No one on waitlist" in script:
        print("  No one on waitlist — come on in!")
    elif "parties ahead" in script:
        parties_match = re.search(r"(\d+)\s*parties? ahead", script)
        if parties_match:
            print(f"  {parties_match.group(1)} parties ahead of you")
    else:
        # Try to find wait time
        wait_match = re.search(r"(\d+)\s*min", script)
        if wait_match:
            print(f"  Estimated wait: {wait_match.group(1)} minutes")
        else:
            print("  Waitlist is active (check the app for details)")


def main():
    parser = argparse.ArgumentParser(
        prog="waitlistme",
        description="Add yourself to a Waitlist.me queue from the command line.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # add command
    p_add = sub.add_parser("add", help="Add yourself to a waitlist")
    p_add.add_argument("--name", required=True, help="Your name")
    p_add.add_argument("--party", type=int, default=2, help="Party size (default: 2)")
    p_add.add_argument("--phone", help="Phone number for text notification")
    p_add.add_argument("--notes", help="Optional notes (e.g. 'booth please')")
    p_add.add_argument("--location", required=True, help="Waitlist.me slug (e.g. sammamishcafe)")
    p_add.set_defaults(func=cmd_add)

    # status command
    p_status = sub.add_parser("status", help="Check waitlist status")
    p_status.add_argument("--location", required=True, help="Waitlist.me slug")
    p_status.set_defaults(func=cmd_status)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
