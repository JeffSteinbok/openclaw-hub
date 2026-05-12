"""
USPS tracking page scraper using Camoufox.

Key selectors (as of May 2026):
  .tb-status                       — current tracking status label
  .tb-step                         — progress bar steps (status, description, location, timestamp)
  .tb-status-detail                — event description lines (fallback, no timestamps)
  .latest-update-banner-wrapper    — banner with expected delivery date (multi-line)
  .current-tracking-status-wrapper — all progress bar step labels
"""

import re
from typing import Any

from .base_tracker import BaseTracker

# Pattern matching USPS timestamp lines like "May 11, 2026, 6:25 pm"
_TIMESTAMP_RE = re.compile(
    r"(?:January|February|March|April|May|June|July|August|September|October|November|December)"
    r"\s+\d{1,2},\s+\d{4}(?:,\s+\d{1,2}:\d{2}\s*[ap]m)?",
    re.IGNORECASE,
)

# Pattern for US location lines like "SAN FRANCISCO CA DISTRIBUTION CENTER"
_LOCATION_RE = re.compile(
    r"^[A-Z][A-Z\s]+(?:,\s*)?[A-Z]{2}(?:\s+\d{5})?\b",
)


class USPSTracker(BaseTracker):
    carrier = "USPS"

    def get_url(self, tracking_number: str) -> str:
        tn = tracking_number.strip().upper()
        return f"https://tools.usps.com/go/TrackConfirmAction?tLabels={tn}"

    async def wait_for_content(self, page: Any) -> None:
        await page.wait_for_selector(
            ".tb-step, .update-banner-wrapper, .banner-content",
            timeout=20000,
        )

    async def extract_status(self, page: Any) -> dict:
        status = "Unknown"
        delivered = False

        # Primary: .tb-status contains the current step label
        status_el = await page.query_selector(".tb-status")
        if status_el:
            status = (await status_el.inner_text()).strip()

        # Fallback: banner wrapper first meaningful line
        if status == "Unknown":
            upd_el = await page.query_selector(
                ".latest-update-banner-wrapper, .update-banner-wrapper"
            )
            if upd_el:
                text = (await upd_el.inner_text()).strip()
                first_line = text.split("\n")[0].strip()
                if first_line:
                    status = first_line

        delivered = status.lower().startswith("delivered")

        # Expected delivery — parse multi-line banner
        expected_delivery = None
        banner_el = await page.query_selector(
            ".latest-update-banner-wrapper, .update-banner-wrapper"
        )
        if banner_el:
            banner_text = (await banner_el.inner_text()).strip()
            # Pattern: "Expected Delivery by\nDAYNAME\nDD\nMonth\nYYYY\nby\nTIME"
            exp_match = re.search(
                r"Expected Delivery by\s+"
                r"(\w+)\s+"           # day name (e.g. THURSDAY)
                r"(\d{1,2})\s+"      # day number
                r"(\w+)\s+"          # month name
                r"(\d{4})\s+"        # year
                r"by\s+(.+?)(?:\n|$)",  # time
                banner_text,
                re.IGNORECASE,
            )
            if exp_match:
                day_name, day, month, year, time_str = exp_match.groups()
                expected_delivery = f"{day_name} {month} {day}, {year} by {time_str.strip()}"

        # Events from .tb-step elements (each has status, description, location, timestamp)
        last_update = None
        description = None
        events: list[dict] = []

        step_els = await page.query_selector_all(".tb-step")
        for step_el in step_els:
            text = (await step_el.inner_text()).strip()
            lines = [l.strip() for l in text.split("\n") if l.strip()]
            if not lines:
                continue

            event: dict = {"status": lines[0]}

            # Find timestamp and location by pattern matching, not fixed position
            for line in lines[1:]:
                ts_match = _TIMESTAMP_RE.search(line)
                if ts_match:
                    event.setdefault("timestamp_raw", ts_match.group(0))
                elif _LOCATION_RE.match(line):
                    event.setdefault("location", line)
                elif "description" not in event and line != lines[0]:
                    event["description"] = line

            events.append(event)

        # Fallback: .tb-status-detail for descriptions without timestamps
        if not events:
            detail_els = await page.query_selector_all(".tb-status-detail")
            for el in detail_els:
                text = (await el.inner_text()).strip()
                if text:
                    events.append({"description": text})

        if events:
            first = events[0]
            description = first.get("description") or first.get("status")
            last_update = first.get("timestamp_raw")

        return {
            "status": status,
            "delivered": delivered,
            "last_update": last_update,
            "description": description,
            "expected_delivery": expected_delivery,
            "events": events,
        }
