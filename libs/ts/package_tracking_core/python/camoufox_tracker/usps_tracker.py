"""
USPS tracking page scraper using Camoufox.
"""

import re
from typing import Any

from .base_tracker import BaseTracker


class USPSTracker(BaseTracker):
    carrier = "USPS"

    def get_url(self, tracking_number: str) -> str:
        tn = tracking_number.strip().upper()
        return f"https://tools.usps.com/go/TrackConfirmAction?tLabels={tn}"

    async def wait_for_content(self, page: Any) -> None:
        await page.wait_for_selector(
            ".banner-content, .track-bar-container, .update-banner-wrapper",
            timeout=20000,
        )

    async def extract_status(self, page: Any) -> dict:
        status = "Unknown"
        delivered = False

        # Primary: update banner wrapper contains the status headline
        upd_el = await page.query_selector(
            ".latest-update-banner-wrapper, .update-banner-wrapper"
        )
        if upd_el:
            text = (await upd_el.inner_text()).strip()
            first_line = text.split("\n")[0].strip()
            if first_line:
                status = first_line

        # Fallback: banner-content h2
        if status == "Unknown":
            banner_el = await page.query_selector(".banner-content h2")
            if banner_el:
                status = (await banner_el.inner_text()).strip()

        if re.search(r"\bdeliver", status, re.IGNORECASE):
            delivered = True

        # Expected delivery
        expected_delivery = None
        exp_el = await page.query_selector(
            ".expected-delivery-date, .expected-delivery, .delivery-date"
        )
        if exp_el:
            expected_delivery = (await exp_el.inner_text()).strip()

        # Full body text for fallback extraction
        last_update = None
        description = None
        events: list[dict] = []

        # Try to find scan history / tracking detail entries
        detail_rows = await page.query_selector_all(
            ".track-bar-container .tracking-detail, "
            "#trackingHistory_list li, "
            ".product-results-content .result-col"
        )
        for row in detail_rows:
            text = (await row.inner_text()).strip()
            lines = [l.strip() for l in text.split("\n") if l.strip()]
            if lines:
                event = {
                    "description": lines[0],
                    "timestamp_raw": lines[1] if len(lines) > 1 else None,
                    "location": lines[2] if len(lines) > 2 else None,
                }
                events.append(event)

        if events:
            description = events[0].get("description")
            last_update = events[0].get("timestamp_raw")

        return {
            "status": status,
            "delivered": delivered,
            "last_update": last_update,
            "description": description,
            "expected_delivery": expected_delivery,
            "events": events,
        }
