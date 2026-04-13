#!/usr/bin/env python3
"""
Fetch Outlook work calendar from the published endpoint.

Uses the Exchange Web Services (EWS) JSON API via a publicly-published
calendar URL. No authentication required. Outputs formatted Markdown
or raw JSON.
"""

import json
import os
import sys
import argparse
from datetime import datetime
import urllib.request
import urllib.error

# ---------- Exchange endpoint constants ----------

def _require_base_url():
    base_url = os.environ.get("OUTLOOK_WORK_CALENDAR_URL")
    if not base_url:
        print("ERROR: OUTLOOK_WORK_CALENDAR_URL environment variable is not set.", file=sys.stderr)
        print("Add it to ~/.openclaw/.env", file=sys.stderr)
        sys.exit(1)
    return base_url

def _require_folder_id():
    folder_id = os.environ.get("OUTLOOK_WORK_FOLDER_ID")
    if not folder_id:
        print("ERROR: OUTLOOK_WORK_FOLDER_ID environment variable is not set.", file=sys.stderr)
        print("Add it to ~/.openclaw/.env", file=sys.stderr)
        sys.exit(1)
    return folder_id
TIMEZONE = "Pacific Standard Time"

def format_date(dt):
    """Format datetime to ISO 8601 with milliseconds."""
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000")

def parse_date_string(date_str):
    """Parse YYYY-MM-DD to datetime."""
    return datetime.strptime(date_str, "%Y-%m-%d")

def build_request_body(start_date, end_date):
    """Build the FindItem JSON request body.

    The payload uses Exchange's typed-JSON format where each object carries
    a ``__type`` annotation so the OWA service can deserialize it properly.
    """
    return {
        "__type": "FindItemJsonRequest:#Exchange",
        "Header": {
            "__type": "JsonRequestHeaders:#Exchange",
            "RequestServerVersion": "Exchange2013",
            "TimeZoneContext": {
                "__type": "TimeZoneContext:#Exchange",
                "TimeZoneDefinition": {
                    "__type": "TimeZoneDefinitionType:#Exchange",
                    "Id": TIMEZONE
                }
            }
        },
        "Body": {
            "__type": "FindItemRequest:#Exchange",
            "ParentFolderIds": [
                {
                    "__type": "FolderId:#Exchange",
                    "Id": _require_folder_id()
                }
            ],
            "ItemShape": {
                "__type": "ItemResponseShape:#Exchange",
                "BaseShape": "IdOnly"
            },
            "Traversal": "Shallow",
            "Paging": {
                "__type": "CalendarPageView:#Exchange",
                "StartDate": start_date,
                "EndDate": end_date
            }
        }
    }

def fetch_calendar(start_date_str, end_date_str):
    """Fetch calendar events from the Outlook published endpoint."""
    base_url = _require_base_url()
    _require_folder_id()
    start_dt = parse_date_string(start_date_str)
    end_dt = parse_date_string(end_date_str)
    
    start_date = format_date(start_dt)
    end_date = format_date(end_dt)
    
    # The "n=18" query param is an opaque token required by the published endpoint
    url = f"{base_url}/service.svc?action=FindItem&app=PublishedCalendar&n=18"
    body = build_request_body(start_date, end_date)
    body_json = json.dumps(body).encode('utf-8')
    
    req = urllib.request.Request(
        url,
        data=body_json,
        method="POST"
    )
    
    # OWA requires these exact headers to accept the JSON payload
    req.add_header("Content-Type", "application/json; charset=utf-8")
    req.add_header("Action", "FindItem")
    
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            data = json.loads(response.read().decode('utf-8'))
            return data
    except urllib.error.HTTPError as e:
        print(f"Error fetching calendar: {e.code} {e.reason}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

def extract_events(response):
    """Extract events from the deeply-nested EWS response structure.

    Path: Body → ResponseMessages → Items[0] → RootFolder → Items
    """
    try:
        items = response["Body"]["ResponseMessages"]["Items"][0]["RootFolder"]["Items"]
        return items
    except (KeyError, IndexError, TypeError):
        return []

def format_event(event):
    """Format a single EWS calendar event as structured Markdown.
    
    Note: EWS FindItem (published calendar endpoint) does not return attendees.
    Only basic event metadata is available: subject, time, location, busy status.
    """
    subject = event.get("Subject", "No subject")
    start = event.get("Start", "Unknown")
    end = event.get("End", "Unknown")
    location = event.get("Location", {}).get("DisplayName", "")
    busy_type = event.get("FreeBusyType", "busy")
    is_all_day = event.get("IsAllDayEvent", False)
    sensitivity = event.get("Sensitivity", "Normal")

    title = subject
    if sensitivity == "Private":
        title += " [PRIVATE]"
    if is_all_day:
        title += " [ALL DAY]"

    lines = [f"## {title}"]
    lines.append(f"- **Time:** {start} – {end}")
    lines.append(f"- **Location:** {location or 'No location'}")
    lines.append(f"- **Status:** {busy_type}")
    lines.append("")
    return "\n".join(lines)

def main():
    # ---------- CLI argument parsing ----------
    from datetime import timedelta

    parser = argparse.ArgumentParser(description="Fetch Outlook work calendar")
    parser.add_argument("--start-date", help="Start date YYYY-MM-DD (default: today)")
    parser.add_argument("--end-date", help="End date YYYY-MM-DD")
    parser.add_argument("--days", type=int, default=7, help="Days ahead to fetch when --end-date omitted (default: 7)")
    parser.add_argument("--json", action="store_true", help="Output raw JSON")
    parser.add_argument("--output-file", help="Write output to this file instead of stdout")

    args = parser.parse_args()

    start_str = args.start_date or datetime.now().strftime("%Y-%m-%d")
    if args.end_date:
        end_str = args.end_date
    else:
        start_dt = datetime.strptime(start_str, "%Y-%m-%d")
        end_str = (start_dt + timedelta(days=args.days)).strftime("%Y-%m-%d")

    # ---------- Fetch and format events ----------

    print(f"Fetching work calendar from {start_str} to {end_str}...", file=sys.stderr)

    response = fetch_calendar(start_str, end_str)
    events = extract_events(response)

    if args.json:
        output = json.dumps(events, indent=2)
    else:
        fetched_at = datetime.now().strftime("%Y-%m-%d %H:%M")
        header = f"# Work Calendar\n_Fetched {fetched_at} \u00b7 {start_str} to {end_str}_\n"
        if not events:
            output = header + "\nNo events found in this period."
        else:
            parts = [header]
            for event in events:
                parts.append(format_event(event))
            output = "\n".join(parts)

    # ---------- Write output ----------

    if args.output_file:
        os.makedirs(os.path.dirname(os.path.abspath(args.output_file)), exist_ok=True)
        with open(args.output_file, "w") as f:
            f.write(output + "\n")
        print(f"Wrote {args.output_file}", file=sys.stderr)
    else:
        print(output)

if __name__ == "__main__":
    main()
