#!/usr/bin/env python3
"""
Fetch an ICS calendar feed and output formatted Markdown.

Supports --env-var to pick the ICS URL from an environment variable,
--label for the calendar display name, --days for the lookahead window,
and --output-file to write directly to a file.
"""

import os, sys, argparse, urllib.request
from datetime import datetime, timedelta


def require_env(name):
    val = os.environ.get(name)
    if not val:
        print(f"ERROR: {name} not set.", file=sys.stderr)
        sys.exit(1)
    return val


def parse_dt(s):
    """Parse an ICS datetime string into a naive datetime."""
    s = s.strip()
    # Strip TZID prefix like "TZID=America/Los_Angeles:"
    if ":" in s:
        s = s.split(":")[-1]
    s = s.rstrip("Z")
    for fmt in ("%Y%m%dT%H%M%S", "%Y%m%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def fmt_dt(s):
    """Format an ICS datetime string as a human-readable string."""
    dt = parse_dt(s)
    if not dt:
        return s
    if "T" in s:
        return dt.strftime("%Y-%m-%d %H:%M")
    return dt.strftime("%Y-%m-%d")


def fetch_ics(url):
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return r.read().decode("utf-8")
    except Exception as e:
        print(f"ERROR fetching ICS: {e}", file=sys.stderr)
        return None


def unescape(s):
    """Unescape ICS text escapes."""
    return s.replace("\\n", "\n").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")


def parse_events(ics_text, start_dt, end_dt):
    """Parse VEVENT blocks from ICS text, filtering to the given date range."""
    events, in_event, current, prev_key = [], False, {}, None
    for raw_line in ics_text.splitlines():
        # Handle folded lines (RFC 5545 line folding)
        if raw_line.startswith((" ", "\t")) and prev_key:
            current[prev_key] = current[prev_key] + raw_line[1:]
            continue
        line = raw_line.strip()
        if line == "BEGIN:VEVENT":
            in_event, current, prev_key = True, {}, None
        elif line == "END:VEVENT":
            in_event = False
            dtstart = current.get("DTSTART")
            if dtstart:
                dt = parse_dt(dtstart)
                if dt and start_dt <= dt < end_dt:
                    events.append(current)
            prev_key = None
        elif in_event and ":" in line:
            k, _, v = line.partition(":")
            key = k.split(";")[0]
            current[key] = v
            prev_key = key
        else:
            prev_key = None
    return events


def format_events_markdown(label, events, start_dt, end_dt):
    """Format a list of ICS events as Markdown."""
    lines = [
        f"# {label} Calendar",
        f"_Fetched {datetime.now().strftime('%Y-%m-%d %H:%M')} · {start_dt.strftime('%Y-%m-%d')} to {end_dt.strftime('%Y-%m-%d')}_",
        "",
    ]
    if not events:
        lines.append("No events found in this period.")
        return "\n".join(lines)

    for e in events:
        subject = unescape(e.get("SUMMARY", "No subject"))
        start = fmt_dt(e.get("DTSTART", ""))
        end = fmt_dt(e.get("DTEND", ""))
        loc = unescape(e.get("LOCATION", "")) or None
        organizer = e.get("ORGANIZER", "")
        if organizer:
            # Strip mailto: prefix
            organizer = organizer.replace("mailto:", "")
        description = unescape(e.get("DESCRIPTION", "")).strip()

        lines.append(f"## {subject}")
        lines.append(f"- **Time:** {start} – {end}")
        if loc:
            lines.append(f"- **Location:** {loc}")
        if organizer:
            lines.append(f"- **Organizer:** {organizer}")
        if description:
            # Only first line of description
            first_line = description.split("\n")[0].strip()
            if first_line:
                lines.append(f"- **Description:** {first_line}")
        lines.append("")

    return "\n".join(lines)


def main():
    p = argparse.ArgumentParser(description="Fetch an ICS calendar feed and output Markdown")
    p.add_argument("--env-var", default="CALENDAR_ICS_URL",
                   help="Environment variable holding the ICS URL (default: CALENDAR_ICS_URL)")
    p.add_argument("--label", default="Calendar",
                   help="Display name for the calendar (default: Calendar)")
    p.add_argument("--days", type=int, default=7,
                   help="Number of days ahead to fetch (default: 7)")
    p.add_argument("--start-date", help="Start date YYYY-MM-DD (default: today)")
    p.add_argument("--end-date", help="End date YYYY-MM-DD (default: today + --days)")
    p.add_argument("--output-file", help="Write Markdown output to this file instead of stdout")
    args = p.parse_args()

    url = require_env(args.env_var)

    start_dt = (datetime.strptime(args.start_date, "%Y-%m-%d")
                if args.start_date else datetime.now().replace(hour=0, minute=0, second=0, microsecond=0))
    end_dt = (datetime.strptime(args.end_date, "%Y-%m-%d")
              if args.end_date else start_dt + timedelta(days=args.days))

    print(f"Fetching {args.label} from {args.env_var} ({start_dt.date()} to {end_dt.date()})...",
          file=sys.stderr)

    ics = fetch_ics(url)
    if ics is None:
        output = f"# {args.label} Calendar\n\nError: could not fetch calendar.\n"
    else:
        events = parse_events(ics, start_dt, end_dt)
        print(f"Found {len(events)} events.", file=sys.stderr)
        output = format_events_markdown(args.label, events, start_dt, end_dt)

    if args.output_file:
        os.makedirs(os.path.dirname(os.path.abspath(args.output_file)), exist_ok=True)
        with open(args.output_file, "w") as f:
            f.write(output + "\n")
        print(f"Wrote {args.output_file}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
