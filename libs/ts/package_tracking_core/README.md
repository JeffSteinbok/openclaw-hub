# 📦 Package Tracking Core

Reusable package-tracking logic shared by the mail runtime's built-in [`detect_tracking`](../mail_runtime_core/README.md#-actions) action and the [`package-tracking` plugin](../../../plugins/package-tracking/README.md). Lives in `libs/ts/package_tracking_core/` so services and plugins can depend on the same implementation without importing plugin source directly.

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
- [`mail_runtime_core/package-tracking.ts`](../mail_runtime_core/README.md) adapts mail envelopes into the built-in `detect_tracking` action
- [`plugins/package-tracking`](../../../plugins/package-tracking/README.md) owns the OpenClaw tool schemas and dispatch surface
- [`services/fastmail-sse`](../../../services/fastmail-sse/README.md) consumes the same core through shared mail actions

---

## 🔗 Related

- [`mail_runtime_core`](../mail_runtime_core/README.md) — Rule engine that invokes `detect_tracking`
- [`mail_action_usps`](../mail_action_usps/README.md) — USPS processing (separate from package tracking)
- [`fastmail-sse`](../../../services/fastmail-sse/README.md) — FastMail adapter that wires tracking into the pipeline
