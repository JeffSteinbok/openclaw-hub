# Package Tracking Plugin

Track packages across UPS, FedEx, USPS, and Amazon. Ships with built-in status
providers for the major carriers and supports custom providers for additional
carriers or API-based overrides.

## Supported Carriers

| Carrier | Status Provider | How it works | Config needed |
|---------|----------------|--------------|---------------|
| **USPS** | Built-in | Web scraper via [Camoufox](https://github.com/nichochar/camoufox) | None — auto-registered |
| **FedEx** | Built-in | Web scraper via Camoufox | None — auto-registered |
| **UPS** | Built-in | Web scraper via Camoufox | None — auto-registered |
| **Amazon** | External | API via [octo-satellite](https://github.com/JeffSteinbok/openclaw-hub/tree/main/plugins/octo-satellite) | Add [`amazon_status_provider`](https://github.com/JeffSteinbok/octo/tree/main/libs/ts/amazon_status_provider) to `status_providers` |

Built-in providers require Python 3.10+ and Camoufox (`pip3 install camoufox && camoufox fetch`).

## Tools

| Tool | Description |
|------|-------------|
| `package_track` | Look up a package by tracking number (detect carrier automatically or specify) |
| `package_add` | Save a tracking number for ongoing monitoring |
| `package_remove` | Remove a saved package |
| `package_list` | List all saved packages |
| `package_scan` | Scan free-form text for tracking numbers |
| `get_package_status` | Get live carrier status from the provider registry |

## Example config

```json
{
  "status_providers": [
    "/path/to/custom_provider/dist/index.js"
  ]
}
```

Built-in providers (USPS, FedEx, UPS) require no configuration — they auto-register on startup.
Only add `status_providers` if you need external providers like Amazon.

## Adding Custom Providers

External providers are ESM modules that export a `register(registry)` function.
They're loaded *after* built-ins and take priority for the same carrier, enabling
API-based overrides with a scraper fallback:

```typescript
import type { CarrierStatusPlugin, StatusProviderRegistry } from '@openclaw/package-tracking-core';

export const register: CarrierStatusPlugin['register'] = (registry) => {
  registry.register({
    name: 'FedEx API',
    carriers: ['FedEx'],
    async getStatus(trackingNumber, carrier) {
      // call FedEx Track API ...
      return { tracking_number: trackingNumber, carrier: 'FedEx', status: 'In Transit',
               delivered: false, last_update: null, description: null };
    },
  });
};
```

Add the compiled path to your plugin config:

```json
{
  "status_providers": [
    "/path/to/my-fedex-api-provider/dist/index.js"
  ]
}
```

If a provider returns `null`, the registry falls through to the next one — so
an API provider can fail gracefully to the built-in scraper.

See [`package_tracking_core` README](../../libs/ts/package_tracking_core/README.md)
for architecture details, the Python CLI, and how to add new built-in carriers.

---

## CLI Usage

All tools are also available as a standalone CLI:

```bash
cd plugins/package-tracking
npm install && npm run build
node dist/bin/package-tracking.js --help
```

### Example commands

```bash
node dist/bin/package-tracking.js package-track ...
node dist/bin/package-tracking.js package-add ...
node dist/bin/package-tracking.js package-remove ...
node dist/bin/package-tracking.js package-list ...
node dist/bin/package-tracking.js package-scan ...
node dist/bin/package-tracking.js get-package-status ...

# JSON output
node dist/bin/package-tracking.js <command> [args...] --json
```

### CLI Environment Variables

| Variable | Description |
|----------|-------------|
| `PACKAGE_TRACKING_STATUS_PROVIDERS` | Paths to external ESM carrier status provider plugin modules |
