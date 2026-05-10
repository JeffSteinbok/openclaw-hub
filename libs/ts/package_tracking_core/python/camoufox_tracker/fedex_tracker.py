"""
FedEx tracking page scraper using Camoufox.

FedEx uses a React SPA. Key classes:
  .shipment-status-progress-container  — progress bar
  .shipment-info-container             — shipment details
  .deliveryDateText                    — estimated delivery
"""

import re
from typing import Any

from .base_tracker import BaseTracker


class FedExTracker(BaseTracker):
    carrier = "FedEx"

    def get_url(self, tracking_number: str) -> str:
        tn = tracking_number.strip().upper()
        return f"https://www.fedex.com/fedextrack/?trknbr={tn}"

    async def wait_for_content(self, page: Any) -> None:
        # FedEx is a React SPA — wait for the progress bar to render.
        await page.wait_for_selector(
            ".shipment-status-progress-container, .shipment-info-container, .track-shared-wrapper",
            timeout=20000,
        )
        # Extra settle time for SPA hydration.
        import asyncio
        await asyncio.sleep(3)

    async def extract_status(self, page: Any) -> dict:
        status = "Unknown"
        delivered = False
        expected_delivery = None

        # Re-grab body text after SPA settles.
        body_text = await page.inner_text("body")

        # Scheduled delivery date — appears as "SCHEDULED DELIVERY DATE\nDay\nDate by time"
        sdd_match = re.search(
            r"SCHEDULED DELIVERY DATE\s*\n\s*(\w+)\s*\n\s*(\d{1,2}/\d{1,2}/\d{2,4})\s*(?:by\s+(.+?))?(?:\n|$)",
            body_text,
        )
        if sdd_match:
            expected_delivery = f"{sdd_match.group(1)} {sdd_match.group(2)}"
            if sdd_match.group(3):
                expected_delivery += f" by {sdd_match.group(3).strip()}"

        # Extract travel history — look for location + date patterns in body
        # FedEx shows: "location\ndate time\nView more details"
        events: list[dict] = []
        last_update = None
        description = None

        # Look for progress steps that are completed/active
        try:
            steps = await page.query_selector_all(".shipment-status-progress-step")
            active_label = None
            for step in steps:
                cls = await step.get_attribute("class") or ""
                label_el = await step.query_selector(".shipment-status-progress-step-label-content")
                if label_el:
                    label = (await label_el.inner_text()).strip()
                    if "active" in cls or "completed" in cls:
                        active_label = label

            if active_label:
                status = active_label
        except Exception:
            pass  # SPA navigation may destroy elements

        # Parse inline travel history from body text
        # Pattern: "On the way\nLOCATION\nDATE TIME"
        history_pattern = re.compile(
            r"(?:On the way|In transit|Picked up|Delivered|Shipment information sent to FedEx|Label created)"
            r"\s*\n\s*([A-Z][A-Za-z\s,]+(?:,\s*[A-Z]{2})?\s*(?:US)?)\s*\n\s*"
            r"(\d{1,2}/\d{1,2}/\d{2,4}\s+\d{1,2}:\d{2}\s*[AP]M)"
        )
        for m in history_pattern.finditer(body_text):
            preceding = body_text[max(0, m.start()-80):m.start()]
            preceding_lines = [l.strip() for l in preceding.split("\n") if l.strip()]
            desc = preceding_lines[-1] if preceding_lines else ""
            events.append({
                "location": m.group(1).strip(),
                "timestamp_raw": m.group(2).strip(),
                "description": desc,
            })

        # Fallback status from body text
        if status == "Unknown":
            m = re.search(
                r"(Delivered|In Transit|On the Way|Picked Up|Out for Delivery|"
                r"Shipment information sent|Label created|Exception)",
                body_text,
                re.IGNORECASE,
            )
            if m:
                status = m.group(1)

        if re.search(r"\bdeliver", status, re.IGNORECASE):
            delivered = True

        if events:
            description = events[0].get("description") or events[0].get("location")
            last_update = events[0].get("timestamp_raw")

        return {
            "status": status,
            "delivered": delivered,
            "last_update": last_update,
            "description": description,
            "expected_delivery": expected_delivery,
            "events": events,
        }
