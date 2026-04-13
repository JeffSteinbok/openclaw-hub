#!/usr/bin/env python3
"""
Fetch personal and family calendars via Microsoft Graph API.

Auth: OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, OUTLOOK_REFRESH_TOKEN from env.
"""

import os, sys, json, urllib.request, urllib.parse
from datetime import datetime, timezone

TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"
GRAPH_BASE = "https://graph.microsoft.com/v1.0"

_CALENDAR_DEFAULTS = {
    "personal": ["calendar", "personal"],
    "family":   ["family v2", "your family", "family"],
}
_CALENDAR_ENV_VARS = {
    "personal": "OUTLOOK_PERSONAL_CALENDAR_NAMES",
    "family":   "OUTLOOK_FAMILY_CALENDAR_NAMES",
}


def _calendar_search_names(key):
    """Return search names: env-var extras (checked first) + built-in defaults."""
    extras = os.environ.get(_CALENDAR_ENV_VARS[key], "")
    extra_names = [n.strip().lower() for n in extras.split(",") if n.strip()]
    return extra_names + _CALENDAR_DEFAULTS[key]


def get_access_token():
    for var in ["OUTLOOK_CLIENT_ID", "OUTLOOK_CLIENT_SECRET", "OUTLOOK_REFRESH_TOKEN"]:
        if not os.environ.get(var):
            raise RuntimeError(f"{var} not set in environment")
    data = urllib.parse.urlencode({
        "client_id": os.environ["OUTLOOK_CLIENT_ID"],
        "client_secret": os.environ["OUTLOOK_CLIENT_SECRET"],
        "refresh_token": os.environ["OUTLOOK_REFRESH_TOKEN"],
        "grant_type": "refresh_token",
        "scope": "Calendars.Read",
    }).encode()
    req = urllib.request.Request(TOKEN_URL, data=data)
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())["access_token"]


def graph_get(token, path):
    req = urllib.request.Request(f"{GRAPH_BASE}{path}")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/json")
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def get_calendars(token):
    data = graph_get(token, "/me/calendars?%24select=id%2Cname&%24top=50")
    return {c["name"].lower(): c["id"] for c in data.get("value", [])}


def utc_to_local(dt_str):
    """Convert Graph API UTC datetime string to local system time."""
    try:
        dt = datetime.strptime(dt_str[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
        return dt.astimezone().strftime("%Y-%m-%d %-I:%M %p")
    except Exception:
        return dt_str[:16]


def format_event(e):
    subject = e.get("subject", "No subject")
    start_raw = e.get("start", {}).get("dateTime", "Unknown")
    end_raw = e.get("end", {}).get("dateTime", "Unknown")
    tz = e.get("start", {}).get("timeZone", "UTC")
    if tz == "UTC":
        start = utc_to_local(start_raw)
        end = utc_to_local(end_raw)
    else:
        start = start_raw[:16]
        end = end_raw[:16]
    loc = e.get("location", {}).get("displayName", "") or "No location"
    organizer = e.get("organizer", {}).get("emailAddress", {})
    organizer_str = organizer.get("name", organizer.get("address", ""))
    attendees = [
        {
            "name": a.get("emailAddress", {}).get("name", ""),
            "email": a.get("emailAddress", {}).get("address", ""),
            "status": a.get("status", {}).get("response", "none"),
            "type": a.get("type", "required"),
        }
        for a in e.get("attendees", [])
    ]
    my_status = e.get("responseStatus", {}).get("response", "none")
    show_as = e.get("showAs", "busy")
    result = {
        "subject": subject,
        "start": start,
        "end": end,
        "location": loc,
        "organizer": organizer_str,
        "my_status": my_status,
        "show_as": show_as,
    }
    if attendees:
        result["attendees"] = attendees
    return result


def fetch_events(token, cal_id, start_date, end_date):
    params = urllib.parse.urlencode({
        "$select": "subject,start,end,location,organizer,attendees,responseStatus,showAs",
        "$orderby": "start/dateTime",
        "$top": "100",
        "startDateTime": f"{start_date}T00:00:00",
        "endDateTime": f"{end_date}T00:00:00",
    })
    data = graph_get(token, f"/me/calendars/{cal_id}/calendarView?{params}")
    return data.get("value", [])


def fetch_calendar(calendar="all", days=7):
    """Fetch calendar events and return structured data."""
    from datetime import timedelta

    token = get_access_token()
    cal_map = get_calendars(token)

    start_date = datetime.now().strftime("%Y-%m-%d")
    end_date = (datetime.now() + timedelta(days=days)).strftime("%Y-%m-%d")

    keys = ["personal", "family"] if calendar == "all" else [calendar]
    labels = {"personal": "Personal", "family": "Family"}
    results = {}

    for key in keys:
        search_names = _calendar_search_names(key)
        cal_id = next((cal_map[n] for n in search_names if n in cal_map), None)
        if not cal_id:
            results[key] = {
                "label": labels[key],
                "error": f"Calendar not found. Available: {list(cal_map.keys())}",
                "events": [],
            }
        else:
            raw_events = fetch_events(token, cal_id, start_date, end_date)
            results[key] = {
                "label": labels[key],
                "count": len(raw_events),
                "start_date": start_date,
                "end_date": end_date,
                "events": [format_event(e) for e in raw_events],
            }

    return results


# ---------- Markdown formatting ----------

_STATUS_LABELS = {
    "accepted": "accepted",
    "tentativelyAccepted": "tentative",
    "declined": "declined",
    "none": "no response",
    "notResponded": "no response",
    "organizer": "organizer",
}


def format_event_markdown(e):
    """Format a single structured event dict as a Markdown section."""
    lines = [f"## {e['subject']}"]
    lines.append(f"- **Time:** {e['start']} \u2013 {e['end']}")
    loc = e.get("location", "No location")
    if loc and loc != "No location":
        lines.append(f"- **Location:** {loc}")
    organizer = e.get("organizer", "")
    if organizer:
        lines.append(f"- **Organizer:** {organizer}")
    attendees = e.get("attendees", [])
    if attendees:
        parts = []
        for a in attendees:
            name = a.get("name", "")
            email = a.get("email", "")
            status = _STATUS_LABELS.get(a.get("status", "none"), a.get("status", "none"))
            label = f"{name} <{email}> ({status})" if name else f"{email} ({status})"
            parts.append(label)
        lines.append(f"- **Attendees:** {', '.join(parts)}")
    my_status = _STATUS_LABELS.get(e.get("my_status", "none"), e.get("my_status", "none"))
    lines.append(f"- **Status:** {my_status}")
    lines.append("")
    return "\n".join(lines)


def results_to_markdown(key, data):
    """Convert fetch_calendar() result for one calendar key to Markdown."""
    label = data.get("label", key.title())
    if "error" in data:
        return f"# {label} Calendar\n\nError: {data['error']}\n"
    events = data.get("events", [])
    start_date = data.get("start_date", "")
    end_date = data.get("end_date", "")
    lines = [
        f"# {label} Calendar",
        f"_Fetched {datetime.now().strftime('%Y-%m-%d %H:%M')} \u00b7 {start_date} to {end_date}_",
        "",
    ]
    if not events:
        lines.append("No events found in this period.")
    else:
        for e in events:
            lines.append(format_event_markdown(e))
    return "\n".join(lines)


# ---------- CLI entry point ----------

def main():
    import argparse
    p = argparse.ArgumentParser(description="Fetch personal and family Outlook calendars")
    p.add_argument("--calendar", choices=["personal", "family", "all"], default="all",
                   help="Which calendar to fetch (default: all)")
    p.add_argument("--days", type=int, default=7,
                   help="Number of days ahead to fetch (default: 7)")
    p.add_argument("--json", action="store_true", help="Output raw JSON instead of Markdown")
    p.add_argument("--output-file", help="Write output to this file (single calendar only)")
    p.add_argument("--output-dir", help="Write calendar-personal.md and calendar-family.md into this directory")
    args = p.parse_args()

    print(f"Fetching Outlook calendar (calendar={args.calendar}, days={args.days})...", file=sys.stderr)
    results = fetch_calendar(calendar=args.calendar, days=args.days)

    if args.json:
        output = json.dumps(results, indent=2)
        if args.output_file:
            os.makedirs(os.path.dirname(os.path.abspath(args.output_file)), exist_ok=True)
            with open(args.output_file, "w") as f:
                f.write(output + "\n")
            print(f"Wrote {args.output_file}", file=sys.stderr)
        else:
            print(output)
        return

    # Markdown output
    if args.output_dir:
        os.makedirs(args.output_dir, exist_ok=True)
        filenames = {"personal": "calendar-jeff.md", "family": "calendar-family.md"}
        for key, data in results.items():
            md = results_to_markdown(key, data)
            path = os.path.join(args.output_dir, filenames.get(key, f"calendar-{key}.md"))
            with open(path, "w") as f:
                f.write(md + "\n")
            count = data.get("count", 0)
            print(f"Wrote {path} ({count} events)", file=sys.stderr)
    elif args.output_file:
        keys = list(results.keys())
        if len(keys) > 1:
            print("WARNING: --output-file with multiple calendars — writing combined output", file=sys.stderr)
        combined = "\n\n".join(results_to_markdown(k, results[k]) for k in keys)
        os.makedirs(os.path.dirname(os.path.abspath(args.output_file)), exist_ok=True)
        with open(args.output_file, "w") as f:
            f.write(combined + "\n")
        print(f"Wrote {args.output_file}", file=sys.stderr)
    else:
        for key, data in results.items():
            print(results_to_markdown(key, data))


if __name__ == "__main__":
    main()
