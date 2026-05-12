"""
UPS tracking page scraper using Camoufox.

UPS uses an Angular SPA that may render content in the main page or
inside an iframe. We search all frames for the body text that contains
tracking data.

Key body-text patterns:
  "Delivered check_circle"          — delivered status
  "In Transit" / "Out for Delivery" — active statuses
  "Thursday\nMay 07\nat 9:52 A.M." — delivery/expected date
  "Delivered To\n...\nLOCATION"    — delivery location
  "Service\nUPS Ground Saver®"     — service type
  "Shipped / Billed On\nMM/DD/YYYY"— ship date
"""

import re
from typing import Any

from .base_tracker import BaseTracker

# Keywords that indicate the frame body has real tracking content.
_TRACKING_MARKERS = re.compile(
    r"Delivered|In Transit|Out [Ff]or Delivery|Picked Up|"
    r"Label Created|Shipment Details|On the Way",
)


class UPSTracker(BaseTracker):
    carrier = "UPS"

    def get_url(self, tracking_number: str) -> str:
        tn = tracking_number.strip().upper()
        return f"https://www.ups.com/track?tracknum={tn}"

    async def wait_for_content(self, page: Any) -> None:
        await page.wait_for_selector(
            ".ups-card, .card-header-custom, [class*='ups-card'], app-root",
            timeout=20000,
        )

    async def _get_body_text(self, page: Any) -> str:
        """Search main page and all child frames for body text with tracking data."""
        best = ""
        for frame in page.frames:
            try:
                text = (await frame.inner_text("body")).strip()
            except Exception:
                continue
            if len(text) > len(best):
                best = text
            if _TRACKING_MARKERS.search(text):
                return text
        return best

    async def extract_status(self, page: Any) -> dict:
        status = "Unknown"
        delivered = False
        service_type = None

        body_text = await self._get_body_text(page)

        # Status from body text — look for "Delivered check_circle" or "In Transit"
        m = re.search(
            r"(Delivered|In Transit|Out [Ff]or Delivery|Picked Up|"
            r"Label Created|Exception|On the Way|Shipping Label Created)"
            r"(?:\s*check_circle)?",
            body_text,
        )
        if m:
            status = m.group(1)

        delivered = status.lower().startswith("delivered")

        # Delivery date/time — "Thursday, May 07\nat\n9:52 A.M." (may span 3-4 lines)
        delivery_match = re.search(
            r"(\w+day)(?:,\s*|\s*\n\s*)(\w+ \d{1,2})\s*\n\s*at\s*\n?\s*(.+?)(?:\n|$)",
            body_text,
        )
        last_update = None
        if delivery_match:
            last_update = f"{delivery_match.group(1)} {delivery_match.group(2)} at {delivery_match.group(3).strip()}"

        # Delivered To location
        description = None
        delivered_to = re.search(r"Delivered To\s*\n\s*(?:expand_\w+\s*\n\s*)?(.+?)(?:\n|$)", body_text)
        if delivered_to:
            loc = delivered_to.group(1).strip()
            if loc and loc not in ("expand_less", "expand_more"):
                description = f"Delivered to {loc}"

        # Service type from Shipment Details
        svc_match = re.search(r"Service\s*\n+\s*(.+?)(?:\n|$)", body_text)
        if svc_match:
            service_type = svc_match.group(1).strip()

        # Shipped date
        shipped_date = None
        ship_match = re.search(r"Shipped / Billed On\s*\n+\s*(\d{2}/\d{2}/\d{4})", body_text)
        if ship_match:
            shipped_date = ship_match.group(1)

        events: list[dict] = []

        return {
            "status": status,
            "delivered": delivered,
            "last_update": last_update,
            "description": description,
            "service_type": service_type,
            "shipped_date": shipped_date,
            "events": events,
        }
