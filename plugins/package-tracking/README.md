# Package Tracking Plugin

Track shipments across the major carriers and keep a lightweight saved list for follow-up. The plugin can also scan copied email text for tracking numbers, which makes it a good companion to the mail plugins without giving it direct inbox access.

Shared tracking business logic lives in `libs/python/package_tracking_core/`; this plugin owns the OpenClaw tool surface over that shared core.

## Tools

| Tool | Description |
|------|-------------|
| `package_track` | Look up a package by tracking number |
| `package_add` | Save a package to the tracking list with an optional label |
| `package_remove` | Remove a saved package from the tracking list |
| `package_list` | Show all saved packages |
| `package_scan` | Scan text for tracking numbers and identify the carrier |

## Supported Carriers

- UPS
- FedEx
- USPS
- Amazon

Carrier detection is automatic in the common case, but you can override the carrier when needed.

## Storage

Saved packages are stored in `~/.openclaw/package_tracking.json`.

## Notes

- No API keys or account setup are required.
- `package_scan` only processes text you explicitly provide, which keeps email scanning opt-in.
- The tool returns tracking URLs you can open in a browser when you want full carrier detail.

## Development

### Test

```bash
cd plugins/package-tracking
python3 tests/test_tools.py
```

### Build

```bash
npm run build
```
