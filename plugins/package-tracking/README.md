# Package Tracking Plugin

Track packages across UPS, FedEx, USPS, and Amazon. Supports pluggable carrier
status providers for live delivery updates.

## Tools

| Tool | Description |
|------|-------------|
| `package_track` | Look up a package by tracking number (detect carrier automatically or specify) |
| `package_add` | Save a tracking number for ongoing monitoring |
| `package_remove` | Remove a saved package |
| `package_list` | List all saved packages |
| `package_scan` | Scan free-form text for tracking numbers |
| `get_package_status` | Get live carrier status (requires a status provider) |

## Configuration

| Key | Type | Description |
|-----|------|-------------|
| `status_providers` | `string[]` | Paths to external ESM carrier status provider modules |

## Pluggable Status Providers

The `get_package_status` tool delegates to external carrier status provider
plugins loaded at startup. Each provider is an ESM module exporting a
`register(registry)` function that adds carrier-specific status lookup logic.

### Writing a provider

```ts
import type { StatusRegistry } from "@openclaw/package-tracking-core";

export async function register(registry: StatusRegistry) {
  registry.addProvider("MyCarrier", {
    async getStatus(trackingNumber: string) {
      // Call carrier API, return structured status
      return { carrier: "MyCarrier", status: "In Transit", ... };
    },
  });
}
```

### Configuring providers

Add the path to your provider module in the plugin config:

```json
{
  "status_providers": [
    "/path/to/my-carrier-provider.js"
  ]
}
```

Providers are loaded asynchronously at startup. If a provider fails to load,
a warning is logged and the remaining providers continue to initialize.

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
