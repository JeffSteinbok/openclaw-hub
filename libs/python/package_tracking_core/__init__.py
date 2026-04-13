#!/usr/bin/env python3
"""Shared package tracking core used by plugins and services."""

from __future__ import annotations

import json
import os
import re
from typing import Dict, List, Optional, Set
from urllib.error import URLError
from urllib.request import Request, urlopen

# Carrier detection patterns (in order of specificity)
CARRIER_PATTERNS = [
    {
        "name": "UPS",
        "patterns": [r"\b1Z[A-Z0-9]{16}\b"],
        "url_template": "https://www.ups.com/track?tracknum={tracking_number}",
    },
    {
        "name": "Amazon",
        "patterns": [r"\bTBA[0-9]{12}US\b"],
        "url_template": "https://track.amazon.com/tracking/{tracking_number}",
    },
    {
        "name": "FedEx",
        "patterns": [
            r"\b[0-9]{12}\b",
            r"\b[0-9]{15}\b",
            r"\b[0-9]{20}\b",
        ],
        "url_template": "https://www.fedex.com/fedextrack/?trknbr={tracking_number}",
    },
    {
        "name": "USPS",
        "patterns": [
            r"\b94[0-9]{20}\b",
            r"\b9[2-5][0-9]{20}\b",
            r"\b[0-9]{20,22}\b",
        ],
        "url_template": "https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1={tracking_number}",
    },
]

# Patterns for validation (stricter - must match entire string)
VALIDATION_PATTERNS = [
    {
        "name": "UPS",
        "patterns": [r"^1Z[A-Z0-9]{16}$"],
    },
    {
        "name": "Amazon",
        "patterns": [r"^TBA[0-9]{12}US$"],
    },
    {
        "name": "FedEx",
        "patterns": [
            r"^[0-9]{12}$",
            r"^[0-9]{15}$",
            r"^[0-9]{20}$",
        ],
    },
    {
        "name": "USPS",
        "patterns": [
            r"^94[0-9]{20}$",
            r"^9[2-5][0-9]{20}$",
            r"^[0-9]{20,22}$",
        ],
    },
]


def detect_carrier(tracking_number: str) -> Optional[str]:
    """Detect carrier from tracking number format."""

    tracking_number = tracking_number.strip().upper()
    for carrier in VALIDATION_PATTERNS:
        for pattern in carrier["patterns"]:
            if re.match(pattern, tracking_number):
                return carrier["name"]
    return None


def get_tracking_url(tracking_number: str, carrier: Optional[str] = None) -> Optional[str]:
    """Generate a tracking URL for a tracking number."""

    tracking_number = tracking_number.strip().upper()
    if not carrier:
        carrier = detect_carrier(tracking_number)
    if not carrier:
        return None

    carrier_upper = carrier.upper()
    for carrier_info in CARRIER_PATTERNS:
        if carrier_info["name"].upper() == carrier_upper:
            return carrier_info["url_template"].format(tracking_number=tracking_number)
    return None


def scan_text_for_tracking_numbers(text: str) -> List[Dict[str, str]]:
    """Scan text for tracking numbers and return matches with detected carrier."""

    if not text:
        return []

    text_upper = text.upper()
    results = []
    seen = set()

    for carrier in CARRIER_PATTERNS:
        for pattern in carrier["patterns"]:
            matches = re.finditer(pattern, text_upper, re.MULTILINE)
            for match in matches:
                tracking_num = match.group(0)
                if tracking_num in seen:
                    continue
                seen.add(tracking_num)
                results.append(
                    {
                        "tracking_number": tracking_num,
                        "carrier": carrier["name"],
                        "url": carrier["url_template"].format(tracking_number=tracking_num),
                    }
                )

    return results


def _get_storage_path() -> str:
    """Get path to package storage file."""

    home = os.path.expanduser("~")
    openclaw_dir = os.path.join(home, ".openclaw")
    os.makedirs(openclaw_dir, exist_ok=True)
    return os.path.join(openclaw_dir, "package_tracking.json")


def _load_packages() -> Dict[str, Dict]:
    """Load tracked packages from storage."""

    storage_path = _get_storage_path()
    if not os.path.exists(storage_path):
        return {}

    try:
        with open(storage_path, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return {}


def _save_packages(packages: Dict[str, Dict]) -> None:
    """Save tracked packages to storage."""

    storage_path = _get_storage_path()
    try:
        with open(storage_path, "w") as f:
            json.dump(packages, f, indent=2)
    except IOError as exc:
        raise Exception(f"Failed to save packages: {exc}")


def add_package(
    tracking_number: str, carrier: Optional[str] = None, label: Optional[str] = None
) -> Dict:
    """Add a package to the tracking list."""

    tracking_number = tracking_number.strip().upper()
    if not tracking_number:
        return {"error": "tracking_number is required"}

    if not carrier:
        carrier = detect_carrier(tracking_number)
    if not carrier:
        return {"error": f"Could not detect carrier for tracking number: {tracking_number}"}

    url = get_tracking_url(tracking_number, carrier)
    if not url:
        return {"error": f"Could not generate tracking URL for carrier: {carrier}"}

    packages = _load_packages()
    packages[tracking_number] = {
        "tracking_number": tracking_number,
        "carrier": carrier,
        "url": url,
        "label": label or "",
        "added_at": _get_timestamp(),
    }
    _save_packages(packages)
    return packages[tracking_number]


def remove_package(tracking_number: str) -> Dict:
    """Remove a package from the tracking list."""

    tracking_number = tracking_number.strip().upper()
    if not tracking_number:
        return {"error": "tracking_number is required"}

    packages = _load_packages()
    if tracking_number not in packages:
        return {"error": f"Package not found: {tracking_number}"}

    del packages[tracking_number]
    _save_packages(packages)
    return {"success": True, "tracking_number": tracking_number}


def list_packages() -> Dict:
    """List all tracked packages."""

    packages = _load_packages()
    return {
        "packages": list(packages.values()),
        "count": len(packages),
    }


def get_package(tracking_number: str) -> Dict:
    """Get info for a specific package."""

    tracking_number = tracking_number.strip().upper()
    if not tracking_number:
        return {"error": "tracking_number is required"}

    packages = _load_packages()
    if tracking_number not in packages:
        return {"error": f"Package not found: {tracking_number}"}

    return packages[tracking_number]


def _get_timestamp() -> str:
    """Get current timestamp in ISO format."""

    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


SHIPPING_SENDERS = [
    "ups.com",
    "fedex.com",
    "usps.com",
    "dhl.com",
    "ontrac.com",
    "lasership.com",
    "amazon.com",
    "amazonlogistics.com",
    "narvar.com",
    "aftership.com",
    "shipbob.com",
    "shipstation.com",
    "easypost.com",
    "noreply@nespresso.com",
]


def is_shipping_sender(sender_email: str) -> bool:
    """Return True if the sender is a known shipping carrier or retailer."""

    if not sender_email:
        return False

    sender_lower = sender_email.lower().strip()
    for entry in SHIPPING_SENDERS:
        entry_lower = entry.lower()
        if "@" in entry_lower:
            if sender_lower == entry_lower:
                return True
            continue
        if sender_lower.endswith("@" + entry_lower) or bool(
            re.search(r"@(?:[a-z0-9-]+\.)*" + re.escape(entry_lower) + r"$", sender_lower)
        ):
            return True
    return False


URL_EXTRACTION_RULES = [
    {
        "name": "Narvar",
        "url_pattern": r"https?://[^\s\"'<>]*narvar\.com/[^\s\"'<>]*",
        "param_patterns": [
            r"[?&]tracking_numbers?=([A-Z0-9]{10,30})",
            r"[?&]tracking=([A-Z0-9]{10,30})",
        ],
        "carrier_from_path": True,
    },
    {
        "name": "UPS",
        "url_pattern": r"https?://[^\s\"'<>]*ups\.com/track[^\s\"'<>]*",
        "param_patterns": [
            r"[?&]tracknum=(1Z[A-Z0-9]{16})",
            r"[?&]InquiryNumber1=(1Z[A-Z0-9]{16})",
        ],
        "carrier_from_path": False,
    },
    {
        "name": "FedEx",
        "url_pattern": r"https?://[^\s\"'<>]*fedex\.com/[^\s\"'<>]*track[^\s\"'<>]*",
        "param_patterns": [
            r"[?&]trknbr=(\d{12,22})",
            r"[?&]trackingnumber=(\d{12,22})",
            r"[?&]trackingNumber=(\d{12,22})",
        ],
        "carrier_from_path": False,
    },
    {
        "name": "USPS",
        "url_pattern": r"https?://[^\s\"'<>]*usps\.com/[^\s\"'<>]*",
        "param_patterns": [
            r"[?&]qtc_tLabels\d?=(\d{20,22})",
            r"[?&]tLabels=(\d{20,22})",
        ],
        "carrier_from_path": False,
    },
    {
        "name": "Amazon",
        "url_pattern": r"https?://[^\s\"'<>]*amazon\.com/[^\s\"'<>]*(?:track|order)[^\s\"'<>]*",
        "param_patterns": [
            r"[?&]tracking-id=(TBA[0-9]{12}US)",
        ],
        "carrier_from_path": False,
    },
]

_NARVAR_CARRIER_PATH_MAP: Dict[str, str] = {
    "ups": "UPS",
    "fedex": "FedEx",
    "usps": "USPS",
    "dhl": "DHL",
    "ontrac": "OnTrac",
    "amazon": "Amazon",
}

_NARVAR_PAGE_PATTERNS = [
    r'"trackingNumber"\s*:\s*"([A-Z0-9]{10,30})"',
    r'["\']tracking_number["\']\s*:\s*["\']([A-Z0-9]{10,30})["\']',
    r'["\']tracking["\']\s*:\s*["\']([A-Z0-9]{10,30})["\']',
    r'data-tracking[-_]?number=["\']([A-Z0-9]{10,30})["\']',
    r'<[^>]*class="[^"]*tracking[^"]*"[^>]*>\s*([A-Z0-9]{10,30})\s*<',
]


def _carrier_from_narvar_url(url: str) -> Optional[str]:
    """Extract carrier name from a Narvar URL path segment."""

    url_lower = url.lower()
    for seg, carrier in _NARVAR_CARRIER_PATH_MAP.items():
        if f"/tracking/{seg}" in url_lower or f"/tracking/{seg}?" in url_lower:
            return carrier
    return None


def extract_tracking_from_urls(text: str) -> List[Dict[str, str]]:
    """Extract tracking numbers from shipping or tracking URLs embedded in text."""

    if not text:
        return []

    results: List[Dict[str, str]] = []
    seen: Set[str] = set()

    for rule in URL_EXTRACTION_RULES:
        for url_match in re.finditer(rule["url_pattern"], text, re.IGNORECASE):
            url = url_match.group(0)
            carrier_hint = (
                _carrier_from_narvar_url(url) or rule["name"]
                if rule.get("carrier_from_path")
                else rule["name"]
            )

            for param_pattern in rule["param_patterns"]:
                match = re.search(param_pattern, url, re.IGNORECASE)
                if not match:
                    continue
                tracking_num = match.group(1).upper()
                if tracking_num in seen:
                    break
                seen.add(tracking_num)
                carrier = carrier_hint or detect_carrier(tracking_num) or "Unknown"
                tracking_url = get_tracking_url(tracking_num, carrier) or url
                results.append(
                    {
                        "tracking_number": tracking_num,
                        "carrier": carrier,
                        "url": tracking_url,
                    }
                )
                break

    return results


def fetch_narvar_tracking(url: str) -> List[Dict[str, str]]:
    """Follow a Narvar tracking URL and extract carrier plus tracking number."""

    found = extract_tracking_from_urls(url)
    if found:
        return found

    try:
        req = Request(
            url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (compatible; OpenClaw/1.0; "
                    "+https://github.com/JeffSteinbok/openclaw)"
                )
            },
        )
        with urlopen(req, timeout=15) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except (URLError, Exception):
        return []

    results: List[Dict[str, str]] = []
    seen: Set[str] = set()
    for pattern in _NARVAR_PAGE_PATTERNS:
        for match in re.finditer(pattern, html, re.IGNORECASE):
            tracking_num = match.group(1).upper()
            if tracking_num in seen:
                continue
            carrier = detect_carrier(tracking_num)
            if not carrier:
                continue
            seen.add(tracking_num)
            tracking_url = get_tracking_url(tracking_num, carrier) or url
            results.append(
                {
                    "tracking_number": tracking_num,
                    "carrier": carrier,
                    "url": tracking_url,
                }
            )

    return results


__all__ = [
    "CARRIER_PATTERNS",
    "VALIDATION_PATTERNS",
    "SHIPPING_SENDERS",
    "URL_EXTRACTION_RULES",
    "add_package",
    "detect_carrier",
    "extract_tracking_from_urls",
    "fetch_narvar_tracking",
    "get_package",
    "get_tracking_url",
    "is_shipping_sender",
    "list_packages",
    "remove_package",
    "scan_text_for_tracking_numbers",
]
