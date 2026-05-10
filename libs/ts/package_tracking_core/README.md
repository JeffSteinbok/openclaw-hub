# 📦 Package Tracking Core

Reusable package-tracking logic shared by the mail runtime's built-in [`detect_tracking`](../mail_runtime_core/README.md#-actions) action and the [`package-tracking` plugin](../../../plugins/package-tracking/README.md). Lives in `libs/ts/package_tracking_core/` so services and plugins can depend on the same implementation without importing plugin source directly.

## Features

- **Carrier detection** for UPS, FedEx, USPS, and Amazon tracking numbers
- **Tracking URL generation** for quick browser handoff
- **Saved package storage** in `~/.openclaw/package_tracking.json`
- **Shipping sender heuristics** for mail-triggered tracking registration
- **URL-based extraction** for carrier/Narvar links embedded in email bodies
- **Built-in status providers** for USPS, FedEx, and UPS (auto-registered by the plugin)
- **Provider registry** for adding custom or API-based status providers

## Built-in Status Providers

The core ships with built-in status providers for **USPS**, **FedEx**, and **UPS**. These are automatically registered when the `package-tracking` plugin loads — no configuration needed.

Each carrier is an independent `CarrierStatusProvider`. Internally they use [Camoufox](https://github.com/nichochar/camoufox) (a stealth Firefox fork) to scrape carrier tracking pages, but this is an implementation detail that can change per-carrier without affecting consumers.

### Prerequisites

The built-in providers require Python 3.10+ and Camoufox:

```bash
pip3 install camoufox
camoufox fetch            # downloads the patched Firefox binary (~300MB, cached)
```

### How it works

```
Plugin                     Core                          Python
┌─────────────┐           ┌──────────────────┐          ┌──────────────────┐
│ get_package │  query    │ StatusRegistry   │  spawn   │ camoufox_tracker │
│   _status   │─────────▶│  ├─ USPS provider│────────▶│   ├─ USPSTracker │
│             │  result   │  ├─ FedEx        │  JSON   │   ├─ FedExTracker│
│             │◀──────────│  ├─ UPS          │◀────────│   └─ UPSTracker  │
│             │           │  └─ (custom...)  │  stdout  │                  │
└─────────────┘           └──────────────────┘          └──────────────────┘
```

Each lookup spawns a fresh headless browser (~5–10s). Fine for on-demand checks, not bulk polling.

### Standalone Python CLI

```bash
cd libs/ts/package_tracking_core/python
python3 -m camoufox_tracker USPS 9400111899223456789012
python3 -m camoufox_tracker FEDEX 522048729814
python3 -m camoufox_tracker UPS   1ZJ22694YW31767769
```

## Custom / Override Providers

External providers can be loaded via `status_providers` in the plugin config. They're registered *after* built-ins, so they take priority (the registry tries providers in reverse order):

```json
{
  "plugin": "package-tracking",
  "config": {
    "status_providers": [
      "/path/to/my-fedex-api-provider/dist/index.js"
    ]
  }
}
```

Any ESM module that exports a `register(registry)` function works:

```typescript
import type { CarrierStatusPlugin, StatusProviderRegistry } from '@openclaw/package-tracking-core';

export const register: CarrierStatusPlugin['register'] = (registry) => {
  registry.register({
    name: 'FedEx API',
    carriers: ['FedEx'],
    async getStatus(trackingNumber, carrier) {
      // call FedEx API directly ...
      return { tracking_number: trackingNumber, carrier: 'FedEx', status: 'In Transit',
               delivered: false, last_update: null, description: null };
    },
  });
};
```

If a provider returns `null`, the registry falls through to the next one. This means you can layer an API provider on top of the built-in scraper as a fallback chain.

## Adding a New Built-in Carrier

1. Create `python/camoufox_tracker/<carrier>_tracker.py` — subclass `BaseTracker` and implement `get_url()`, `wait_for_content()`, `extract_status()`
2. Register the class in `python/camoufox_tracker/__main__.py`'s `TRACKERS` dict
3. Add a new `makeProvider()` call in `src/providers/camoufox.ts` and export it
4. Re-export from `src/providers/index.ts`
5. Add to the `builtinProviders` array

## Public API

- `detectCarrier()`
- `getTrackingUrl()`
- `scanTextForTrackingNumbers()`
- `addPackage()`
- `removePackage()`
- `listPackages()`
- `getPackage()`
- `isShippingSender()`
- `extractTrackingFromUrls()`
- `fetchNarvarTracking()`
- `statusRegistry` — singleton provider registry
- `uspsProvider`, `fedexProvider`, `upsProvider` — built-in providers
- `builtinProviders` — array of all built-in providers

## Boundaries

- `package_tracking_core` owns reusable tracking business logic, persistence, and built-in providers
- [`mail_runtime_core/package-tracking.ts`](../mail_runtime_core/README.md) adapts mail envelopes into the built-in `detect_tracking` action
- [`plugins/package-tracking`](../../../plugins/package-tracking/README.md) owns the OpenClaw tool schemas and dispatch surface
- [`services/fastmail-sse`](../../../services/fastmail-sse/README.md) consumes the same core through shared mail actions

---

## 🔗 Related

- [`mail_runtime_core`](../mail_runtime_core/README.md) — Rule engine that invokes `detect_tracking`
- [`mail_action_usps`](../mail_action_usps/README.md) — USPS processing (separate from package tracking)
- [`fastmail-sse`](../../../services/fastmail-sse/README.md) — FastMail adapter that wires tracking into the pipeline
