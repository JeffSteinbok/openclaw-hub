"""
CLI entry point for the Camoufox tracking scraper.

Usage:
    python3 -m camoufox_tracker <carrier> <tracking_number>

Outputs a JSON envelope to stdout:
    {"ok": true, "result": { ... }}
    {"ok": false, "error": {"code": "...", "message": "..."}}

All logs and diagnostics go to stderr.
"""

import asyncio
import json
import sys

from .base_tracker import TrackerError
from .usps_tracker import USPSTracker
from .fedex_tracker import FedExTracker
from .ups_tracker import UPSTracker

TRACKERS = {
    "USPS": USPSTracker,
    "FEDEX": FedExTracker,
    "UPS": UPSTracker,
}


def emit_ok(result: dict) -> None:
    json.dump({"ok": True, "result": result}, sys.stdout)
    sys.stdout.write("\n")
    sys.stdout.flush()


def emit_error(code: str, message: str) -> None:
    json.dump({"ok": False, "error": {"code": code, "message": message}}, sys.stdout)
    sys.stdout.write("\n")
    sys.stdout.flush()


async def main() -> int:
    if len(sys.argv) != 3:
        emit_error("INVALID_ARGS", f"Usage: python3 -m camoufox_tracker <carrier> <tracking_number>")
        return 1

    carrier_raw = sys.argv[1].strip().upper()
    tracking_number = sys.argv[2].strip().upper()

    if carrier_raw not in TRACKERS:
        emit_error("UNSUPPORTED_CARRIER", f"Carrier '{carrier_raw}' not supported. Use: {', '.join(TRACKERS)}")
        return 1

    tracker_cls = TRACKERS[carrier_raw]
    tracker = tracker_cls()

    try:
        result = await asyncio.wait_for(tracker.track(tracking_number), timeout=45)
        emit_ok(result)
        return 0
    except asyncio.TimeoutError:
        emit_error("TIMEOUT", f"Tracking timed out after 30s for {carrier_raw} {tracking_number}")
        return 1
    except TrackerError as exc:
        emit_error(exc.code, str(exc))
        return 1
    except Exception as exc:
        print(f"[camoufox_tracker] unexpected error: {exc}", file=sys.stderr)
        emit_error("INTERNAL_ERROR", str(exc))
        return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
