#!/usr/bin/env python3
"""
Build/update usage-weekly.csv from usage-trends.csv.

Groups daily per-agent rows into ISO weeks (week ending Sunday).
Writes one row per (week_ending, agent) with total cost.

Usage:
  python3 build_weekly_csv.py          # all time
  python3 build_weekly_csv.py --recent # last 16 weeks only

Output: $OPENCLAW_LOGS_DIR/usage-weekly.csv
"""

import csv
import os
import sys
import tempfile
import shutil
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

_logs = os.environ.get("OPENCLAW_LOGS_DIR", os.path.expanduser("~/.openclaw/logs"))
TRENDS_CSV = Path(_logs) / "usage-trends.csv"
WEEKLY_CSV = Path(_logs) / "usage-weekly.csv"

WEEKLY_FIELDS = ["week_ending", "agent", "est_cost_usd"]

KNOWN_AGENTS = {"root", "main", "coding", "mail", "finance", "hass-hooks", "family"}


def week_ending(ds: str) -> str:
    """Return the Sunday on or after the given date string (YYYY-MM-DD)."""
    d = date.fromisoformat(ds)
    days_until_sunday = (6 - d.weekday()) % 7
    return (d + timedelta(days=days_until_sunday)).isoformat()


def main():
    recent_only = "--recent" in sys.argv

    if not TRENDS_CSV.exists():
        print(f"ERROR: {TRENDS_CSV} not found")
        sys.exit(1)

    # Aggregate
    agg = defaultdict(float)
    with open(TRENDS_CSV) as f:
        for row in csv.DictReader(f):
            ds = row.get("date", "")
            if not ds:
                continue
            agent = row.get("agent", "unknown")
            if agent not in KNOWN_AGENTS:
                agent = "other"
            cost = float(row.get("est_cost_usd", 0) or 0)
            we = week_ending(ds)
            agg[(we, agent)] += cost

    if recent_only:
        all_weeks = sorted(set(k[0] for k in agg))
        cutoff = all_weeks[-16] if len(all_weeks) >= 16 else all_weeks[0]
        agg = {k: v for k, v in agg.items() if k[0] >= cutoff}

    rows = [
        {"week_ending": we, "agent": agent, "est_cost_usd": f"{cost:.4f}"}
        for (we, agent), cost in sorted(agg.items())
    ]

    WEEKLY_CSV.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=WEEKLY_CSV.parent, suffix=".tmp")
    with os.fdopen(fd, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=WEEKLY_FIELDS)
        w.writeheader()
        w.writerows(rows)
    shutil.move(tmp, WEEKLY_CSV)

    weeks = sorted(set(r["week_ending"] for r in rows))
    print(f"Written: {WEEKLY_CSV} ({len(rows)} rows, {len(weeks)} weeks)")


if __name__ == "__main__":
    main()
