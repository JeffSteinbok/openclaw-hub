"""Package tracking plugin tools — track packages from UPS, FedEx, USPS, Amazon."""

import json
import sys
from pathlib import Path


def _bootstrap_python_libs() -> None:
    anchor = Path(__file__).resolve()
    for base in anchor.parents:
        vendored_dir = base / "python"
        if vendored_dir.is_dir():
            vendored_str = str(vendored_dir)
            if vendored_str not in sys.path:
                sys.path.insert(0, vendored_str)
            return
    for base in anchor.parents:
        libs_dir = base / "libs" / "python"
        if libs_dir.is_dir() and (base / "package.json").is_file():
            libs_str = str(libs_dir)
            if libs_str not in sys.path:
                sys.path.insert(0, libs_str)
            return


_bootstrap_python_libs()

from repo_paths.bootstrap import bootstrap_repo_paths

BOOTSTRAP_PATHS = bootstrap_repo_paths(__file__)

from package_tracking_core import (
    add_package,
    detect_carrier,
    get_tracking_url,
    get_package,
    list_packages,
    remove_package,
    scan_text_for_tracking_numbers,
)


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


def handle_package_track(args: dict) -> dict:
    """Get tracking info for a package by tracking number."""
    tracking_number = args.get("tracking_number", "").strip()

    if not tracking_number:
        return {"error": "tracking_number is required"}

    carrier = args.get("carrier")

    # Try to get from saved packages first
    package = get_package(tracking_number)
    if "error" not in package:
        return package

    # Not saved, try to detect carrier and generate URL
    if not carrier:
        carrier = detect_carrier(tracking_number)

    if not carrier:
        return {
            "error": f"Could not detect carrier for tracking number: {tracking_number}. "
            "Please specify carrier (UPS, FedEx, USPS, Amazon) manually."
        }

    url = get_tracking_url(tracking_number, carrier)
    if not url:
        return {"error": f"Could not generate tracking URL for carrier: {carrier}"}

    return {
        "tracking_number": tracking_number.upper(),
        "carrier": carrier,
        "url": url,
        "saved": False,
    }


def handle_package_add(args: dict) -> dict:
    """Add a package to the tracking list."""
    tracking_number = args.get("tracking_number", "").strip()

    if not tracking_number:
        return {"error": "tracking_number is required"}

    carrier = args.get("carrier")
    label = args.get("label")

    return add_package(tracking_number, carrier, label)


def handle_package_remove(args: dict) -> dict:
    """Remove a package from the tracking list."""
    tracking_number = args.get("tracking_number", "").strip()

    if not tracking_number:
        return {"error": "tracking_number is required"}

    return remove_package(tracking_number)


def handle_package_list(args: dict) -> dict:
    """List all tracked packages."""
    return list_packages()


def handle_package_scan(args: dict) -> dict:
    """Scan text for tracking numbers."""
    text = args.get("text", "")

    if not text:
        return {"error": "text is required"}

    results = scan_text_for_tracking_numbers(text)

    return {
        "tracking_numbers": results,
        "count": len(results),
    }


# ---------------------------------------------------------------------------
# Standard plugin dispatch
# ---------------------------------------------------------------------------

TOOLS = {
    "package_track": {
        "description": "Look up a package by tracking number and return the carrier and tracking URL.",
        "input_schema": {
            "type": "object",
            "properties": {
                "tracking_number": {
                    "type": "string",
                    "description": "Package tracking number (e.g., 1Z999AA10123456784, 940000000000000000000, TBA012345678901US)",
                },
                "carrier": {
                    "type": "string",
                    "description": "Optional carrier override: UPS, FedEx, USPS, or Amazon",
                },
            },
            "required": ["tracking_number"],
            "additionalProperties": False,
        },
        "handler": handle_package_track,
    },
    "package_add": {
        "description": "Save a package to the tracking list, with an optional label.",
        "input_schema": {
            "type": "object",
            "properties": {
                "tracking_number": {
                    "type": "string",
                    "description": "Package tracking number",
                },
                "carrier": {
                    "type": "string",
                    "description": "Optional carrier override: UPS, FedEx, USPS, or Amazon",
                },
                "label": {
                    "type": "string",
                    "description": "Optional label/description for the package",
                },
            },
            "required": ["tracking_number"],
            "additionalProperties": False,
        },
        "handler": handle_package_add,
    },
    "package_remove": {
        "description": "Remove a saved package from the tracking list.",
        "input_schema": {
            "type": "object",
            "properties": {
                "tracking_number": {
                    "type": "string",
                    "description": "Package tracking number to remove",
                },
            },
            "required": ["tracking_number"],
            "additionalProperties": False,
        },
        "handler": handle_package_remove,
    },
    "package_list": {
        "description": "List saved packages with carriers, tracking URLs, labels, and added dates.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
        "handler": handle_package_list,
    },
    "package_scan": {
        "description": "Scan text for package tracking numbers and identify their carriers.",
        "input_schema": {
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "Text to scan for tracking numbers (e.g., email body)",
                },
            },
            "required": ["text"],
            "additionalProperties": False,
        },
        "handler": handle_package_scan,
    },
}


def manifest() -> dict:
    return {
        "tools": [
            {
                "name": name,
                "description": info["description"],
                "input_schema": info["input_schema"],
            }
            for name, info in TOOLS.items()
        ]
    }


def call(tool: str, args: dict):
    if tool not in TOOLS:
        return {"error": f"Unknown tool: {tool}"}
    return TOOLS[tool]["handler"](args)


def main():
    payload = json.load(sys.stdin)
    method = payload["method"]
    if method == "manifest":
        print(json.dumps(manifest()))
    elif method == "call":
        print(json.dumps(call(payload["tool"], payload.get("args", {}))))


if __name__ == "__main__":
    main()
