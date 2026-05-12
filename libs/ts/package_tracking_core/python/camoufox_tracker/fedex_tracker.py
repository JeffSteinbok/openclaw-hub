"""
FedEx tracking page scraper using Camoufox.

FedEx uses an Angular SPA that needs ~15-20s to fully render.
Content appears in the main frame body text once hydrated.

Key body-text patterns (as of May 2026):
  "DELIVERY DATE\nToday\nEstimated between\nTIME - TIME"
  "FROM\nCity, ST US"  /  "TO\nCity, ST US"
  "WE HAVE YOUR PACKAGE" / "ON THE WAY" / "OUT FOR DELIVERY" / "DELIVERED"
  "Out for delivery\nLOCATION\nDATE TIME\nView more details"
  "Delivered\nLOCATION\nDATE TIME"

Important: The correct URL is /fedextrack/ (not /wtrk/track/).
"""

import asyncio
import re
from typing import Any

from .base_tracker import BaseTracker

_TRACKING_MARKERS = re.compile(
    r"Delivered|In Transit|Out for delivery|WE HAVE YOUR PACKAGE|ON THE WAY|Shipment information",
    re.IGNORECASE,
)


class FedExTracker(BaseTracker):
    carrier = "FedEx"

    def get_url(self, tracking_number: str) -> str:
        tn = tracking_number.strip().upper()
        return f"https://www.fedex.com/fedextrack/?trknbr={tn}"

    async def wait_for_content(self, page: Any) -> None:
        # Don't wait for networkidle — FedEx has long-running analytics scripts
        # that prevent networkidle from resolving quickly. Instead, just give
        # the SPA a moment to start rendering. The real content polling happens
        # in extract_status.
        await asyncio.sleep(3)

    async def _get_body_text(self, page: Any) -> str:
        """Search main page and all frames for body text with tracking data."""
        best = ""
        for frame in page.frames:
            try:
                text = (await frame.inner_text("body")).strip()
            except Exception:
                continue
            if _TRACKING_MARKERS.search(text):
                return text
            if len(text) > len(best):
                best = text
        return best

    async def extract_status(self, page: Any) -> dict:
        # FedEx SPA needs extra time beyond what the base class provides.
        # Poll for up to 20s for tracking content to appear.
        body_text = ""
        for _ in range(20):
            body_text = await self._get_body_text(page)
            if _TRACKING_MARKERS.search(body_text):
                break
            await asyncio.sleep(1)
        else:
            body_text = await self._get_body_text(page)
        status = "Unknown"
        delivered = False
        expected_delivery = None

        body_text = await self._get_body_text(page)

        # Check for "not found" before parsing
        if "can't find that tracking number" in body_text.lower():
            return {
                "status": "Not Found",
                "delivered": False,
                "last_update": None,
                "description": "Tracking number not found on FedEx",
                "expected_delivery": None,
                "events": [],
            }

        # Status from progress steps: "WE HAVE YOUR PACKAGE" / "ON THE WAY" / "OUT FOR DELIVERY" / "DELIVERED"
        # The last step with detail text beneath it is the current status.
        progress_steps = ["WE HAVE YOUR PACKAGE", "ON THE WAY", "OUT FOR DELIVERY", "DELIVERED"]
        active_step = None
        for step in progress_steps:
            if step in body_text.upper():
                active_step = step

        # More specific status from detail line (e.g. "Out for delivery")
        detail_match = re.search(
            r"(Delivered|Out for delivery|In transit|Picked up|"
            r"Shipment information sent to FedEx|Label created|"
            r"At local FedEx facility|At destination sort facility|"
            r"In transit to|On FedEx vehicle for delivery)\s*\n",
            body_text,
            re.IGNORECASE,
        )
        if detail_match:
            status = detail_match.group(1).strip()
        elif active_step:
            status = active_step.title()

        delivered = status.lower().startswith("delivered")

        # Expected delivery — "DELIVERY DATE\n\nToday\nEstimated between\n10:20 AM - 2:20 PM"
        # or "DELIVERY DATE\n\nWed 5/14/26\nEstimated between\n..."
        exp_match = re.search(
            r"DELIVERY DATE\s*\n\s*\n?\s*(.+?)(?:\n|$)",
            body_text,
        )
        if exp_match:
            date_line = exp_match.group(1).strip()
            # Check for time range on next line
            time_match = re.search(
                r"Estimated between\s*\n\s*(.+?)(?:\n|$)",
                body_text,
            )
            if time_match:
                expected_delivery = f"{date_line}, {time_match.group(1).strip()}"
            else:
                expected_delivery = date_line

        # Origin and destination
        origin = None
        destination = None
        from_match = re.search(r"FROM\s*\n\s*(.+?)(?:\n|$)", body_text)
        if from_match:
            origin = from_match.group(1).strip()
        to_match = re.search(r"(?:^|\n)\s*TO\s*\n\s*(.+?)(?:\n|$)", body_text)
        if to_match:
            destination = to_match.group(1).strip()

        # Events — "Out for delivery\nLOCATION\nDATE TIME\nView more details"
        events: list[dict] = []
        last_update = None
        description = None

        # Find event blocks: description\nlocation\ndate
        event_pattern = re.compile(
            r"(Delivered|Out for delivery|In transit|Picked up|"
            r"Shipment information sent to FedEx|Label created|"
            r"At local FedEx facility|At destination sort facility|"
            r"Departed FedEx location|Arrived at FedEx location|"
            r"On FedEx vehicle for delivery|In transit to)\s*\n"
            r"\s*([A-Z][A-Za-z\s,]+(?:,\s*[A-Z]{2})?\s*(?:US)?)\s*\n"
            r"\s*(\d{1,2}/\d{1,2}/\d{2,4}\s+\d{1,2}:\d{2}\s*[AP]M)",
            re.IGNORECASE,
        )
        for m in event_pattern.finditer(body_text):
            events.append({
                "description": m.group(1).strip(),
                "location": m.group(2).strip(),
                "timestamp_raw": m.group(3).strip(),
            })

        if events:
            description = f"{events[0].get('description')} — {events[0].get('location', '')}"
            last_update = events[0].get("timestamp_raw")

        return {
            "status": status,
            "delivered": delivered,
            "last_update": last_update,
            "description": description,
            "expected_delivery": expected_delivery,
            "origin": origin,
            "destination": destination,
            "events": events,
        }
