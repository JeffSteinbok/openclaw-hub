#!/usr/bin/env python3
"""Shared mail-to-package-tracking helpers built on package_tracking_core."""

from __future__ import annotations

import re
from typing import Callable, Protocol

import package_tracking_core

from .runtime import MailEnvelope


DELIVERY_KEYWORDS = [
    "delivered",
    "package delivered",
    "your order has been delivered",
    "delivery complete",
    "successfully delivered",
    "has been delivered",
    "your package was delivered",
    "item delivered",
    "order delivered",
]

_AMAZON_DOMAINS = ("amazon.com", "amazonlogistics.com")
_NARVAR_URL_PATTERN = r"https?://[^\s\"'<>]*narvar\.com/[^\s\"'<>]*"


class TrackingClient(Protocol):
    """Minimal tracking client contract used by mail actions."""

    def is_shipping_sender(self, sender_email: str) -> bool: ...

    def scan_text_for_tracking_numbers(self, text: str) -> list[dict]: ...

    def extract_tracking_from_urls(self, text: str) -> list[dict]: ...

    def fetch_narvar_tracking(self, url: str) -> list[dict]: ...

    def add_package(self, tracking_number: str, carrier: str, label: str) -> dict: ...

    def remove_package(self, tracking_number: str) -> dict: ...


def is_delivery_notification(subject: str) -> bool:
    """Return True when the subject suggests a package was delivered."""

    low = (subject or "").lower()
    return any(keyword in low for keyword in DELIVERY_KEYWORDS)


def load_tracking_client() -> TrackingClient:
    """Load and return the shared package tracking core module."""

    return package_tracking_core


def _combined_body(envelope: MailEnvelope) -> str:
    return " ".join(filter(None, [envelope.body_text, envelope.body_html]))


def _is_amazon_sender(sender_email: str) -> bool:
    sender_email_low = (sender_email or "").lower()
    return any(
        sender_email_low.endswith("@" + domain)
        or bool(
            re.search(
                r"@(?:[a-z0-9-]+\.)*" + re.escape(domain) + r"$",
                sender_email_low,
            )
        )
        for domain in _AMAZON_DOMAINS
    )


def scan_and_add_packages(
    envelope: MailEnvelope,
    *,
    account_label: str,
    logger: Callable[[str], None],
    tracking_client_loader: Callable[[], TrackingClient] = load_tracking_client,
) -> list[str]:
    """Scan an email envelope for tracking numbers and add them to package tracking."""

    sender_email = envelope.sender_email or "unknown"
    sender_name = envelope.sender_name or ""
    subject = envelope.subject or "(no subject)"

    try:
        tracking_client = tracking_client_loader()

        if not tracking_client.is_shipping_sender(sender_email):
            logger(f"skipping tracking scan: non-shipping sender {sender_email}")
            return []

        if _is_amazon_sender(sender_email):
            logger(
                f"skipping tracking scan: Amazon sender {sender_email} "
                "(not trackable externally)"
            )
            return []

        body_text = envelope.body_text or ""
        found = tracking_client.scan_text_for_tracking_numbers(body_text) if body_text else []

        combined_text = _combined_body(envelope)
        url_found = tracking_client.extract_tracking_from_urls(combined_text)

        narvar_urls = re.findall(_NARVAR_URL_PATTERN, combined_text, re.IGNORECASE)
        for narvar_url in narvar_urls[:3]:
            url_found.extend(tracking_client.fetch_narvar_tracking(narvar_url))

        seen_numbers = {result["tracking_number"] for result in found}
        for result in url_found:
            tracking_number = result["tracking_number"]
            if tracking_number not in seen_numbers:
                seen_numbers.add(tracking_number)
                found.append(result)

        if not found:
            return []

        added: list[str] = []
        for tracking_info in found:
            tracking_number = tracking_info["tracking_number"]
            carrier = tracking_info["carrier"]
            label = f"{account_label}: {sender_name or sender_email} - {subject[:40]}"

            result = tracking_client.add_package(tracking_number, carrier, label)
            if "error" in result:
                logger(
                    f"warn: failed to add package {tracking_number}: {result.get('error')}"
                )
                continue

            added.append(tracking_number)
            logger(f"📦 added package: {tracking_number} ({carrier}) — {label}")

        return added
    except Exception as exc:
        logger(f"error: package tracking failed: {exc}")
        return []


def scan_and_remove_delivered(
    envelope: MailEnvelope,
    *,
    logger: Callable[[str], None],
    tracking_client_loader: Callable[[], TrackingClient] = load_tracking_client,
) -> list[str]:
    """Scan a delivery email and remove matching tracked packages."""

    scan_text = envelope.body_text or envelope.subject or ""

    try:
        tracking_client = tracking_client_loader()
        found = tracking_client.scan_text_for_tracking_numbers(scan_text)
        if not found:
            logger(f"delivery email but no tracking number found: {envelope.subject}")
            return []

        removed: list[str] = []
        for tracking_info in found:
            tracking_number = tracking_info["tracking_number"]
            carrier = tracking_info["carrier"]
            result = tracking_client.remove_package(tracking_number)
            if result.get("success"):
                removed.append(tracking_number)
                logger(f"✅ removed delivered package: {tracking_number} ({carrier})")
            elif result.get("error") == "not_found":
                logger(
                    f"delivery notice for untracked package: {tracking_number} — ignoring"
                )
            else:
                logger(f"warn: failed to remove {tracking_number}: {result}")

        return removed
    except Exception as exc:
        logger(f"error: delivery removal failed: {exc}")
        return []
