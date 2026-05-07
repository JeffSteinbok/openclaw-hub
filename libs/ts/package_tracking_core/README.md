# Package Tracking Core

Reusable package-tracking logic shared by the mail runtime's built-in `detect_tracking` action and the `package-tracking` plugin. Lives in `libs/ts/package_tracking_core/` so services and plugins can depend on the same implementation without importing plugin source directly.

## Features

- **Carrier detection** for UPS, FedEx, USPS, and Amazon tracking numbers
- **Tracking URL generation** for quick browser handoff
- **Saved package storage** in `~/.openclaw/package_tracking.json`
- **Shipping sender heuristics** for mail-triggered tracking registration
- **URL-based extraction** for carrier/Narvar links embedded in email bodies

## Public API

- `detect_carrier(...)`
- `get_tracking_url(...)`
- `scan_text_for_tracking_numbers(...)`
- `add_package(...)`
- `remove_package(...)`
- `list_packages(...)`
- `get_package(...)`
- `is_shipping_sender(...)`
- `extract_tracking_from_urls(...)`
- `fetch_narvar_tracking(...)`

## Boundaries

- `package_tracking_core` owns reusable tracking business logic and persistence
- `mail_runtime_core/package-tracking.ts` adapts mail envelopes into the built-in `detect_tracking` action
- `plugins/package-tracking` owns the OpenClaw tool schemas and dispatch surface
- `services/fastmail-sse` consumes the same core through shared mail actions
