# Camoufox Status Provider

Universal carrier status provider for the `package-tracking` plugin.
Uses [Camoufox](https://github.com/nichochar/camoufox) — a stealth Firefox
fork — to scrape live tracking data from carrier websites without triggering
bot detection.

## Supported Carriers

| Carrier | URL pattern | Extraction method |
|---------|-------------|-------------------|
| USPS    | `tools.usps.com/go/TrackConfirmAction` | DOM selectors + banner text |
| FedEx   | `fedex.com/fedextrack` | Progress-bar steps + body-text regex |
| UPS     | `ups.com/track` | Body-text regex (Angular SPA) |

## Prerequisites

Camoufox must be installed system-wide (Python 3.10+):

```bash
pip3 install camoufox
camoufox fetch            # downloads the patched Firefox binary
```

## Architecture

```
TypeScript (index.ts)          Python (camoufox_tracker/)
┌──────────────────┐           ┌──────────────────────┐
│ CarrierStatusPlugin │ spawn  │ __main__.py           │
│ register()        │───────▶ │   ├─ USPSTracker      │
│ getStatus()       │ JSON    │   ├─ FedExTracker     │
│                   │◀─────── │   └─ UPSTracker       │
└──────────────────┘ stdout   │                       │
                               │ BaseTracker (ABC)     │
                               │   • Camoufox lifecycle│
                               │   • Timeout handling  │
                               │   • Challenge detect  │
                               └──────────────────────┘
```

**Protocol:** Python prints a single JSON envelope to stdout and exits:
```json
{"ok": true,  "result": { "tracking_number": "...", "status": "...", ... }}
{"ok": false, "error":  { "code": "TIMEOUT", "message": "..." }}
```

All logs and diagnostics go to stderr.

## Usage

### As a plugin provider

Add the compiled path to your `openclaw.json`:

```json
{
  "plugin": "package-tracking",
  "config": {
    "status_providers": [
      "/path/to/openclaw-hub/libs/ts/camoufox_status_provider/dist/index.js"
    ]
  }
}
```

### Standalone Python CLI

```bash
cd libs/ts/camoufox_status_provider/python
python3 -m camoufox_tracker USPS 9400111899223456789012
python3 -m camoufox_tracker FEDEX 522048729814
python3 -m camoufox_tracker UPS   1ZJ22694YW31767769
```

## Building

```bash
npm install
npm run build    # compiles TypeScript → dist/
npm test         # 8 unit tests (mocked subprocess)
```

Live integration tests (slow, hits real carrier sites):
```bash
RUN_LIVE_TRACKING_TESTS=1 npm test
```

## Adding a new carrier

1. Create `python/camoufox_tracker/<carrier>_tracker.py`
2. Subclass `BaseTracker` — implement `get_url()`, `wait_for_content()`,
   and `extract_status()`
3. Register the class in `__main__.py`'s `TRACKERS` dict
4. Add the carrier name to `SUPPORTED_CARRIERS` in `src/index.ts`

## Notes

- Each tracking lookup launches a fresh Camoufox browser (~5–10s).
  Acceptable for on-demand checks, not ideal for bulk polling.
- Carrier page selectors are inherently fragile — HTML changes may require
  updates to the extractor classes.
- The `CAMOUFOX_STATUS_PYTHON` env var overrides the Python interpreter
  (default: `python3`).
