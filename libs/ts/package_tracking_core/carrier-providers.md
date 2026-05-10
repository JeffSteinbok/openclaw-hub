# Package Tracking — Carrier Status Providers

The `package-tracking` plugin supports pluggable carrier status providers that supply live
tracking information. By default no providers are included (carrier APIs require credentials or
web scraping that are out of scope for the open-source plugin). You can register your own
providers via external ESM modules loaded from the plugin config.

---

## The `CarrierStatusProvider` interface

```ts
import type { CarrierStatusProvider, CarrierStatusResult } from '@openclaw/package-tracking-core';

const myProvider: CarrierStatusProvider = {
  name: 'MyCarrier',
  carriers: ['MyCarrier'],           // or ['*'] to handle any carrier
  async getStatus(trackingNumber, carrier) {
    // Fetch live data ...
    return {
      tracking_number: trackingNumber,
      carrier: 'MyCarrier',
      status: 'In Transit',
      delivered: false,
      last_update: new Date().toISOString(),
      description: 'Arrived at facility, Chicago IL',
    };
  },
};
```

### `CarrierStatusResult` fields

| Field | Type | Description |
|---|---|---|
| `tracking_number` | `string` | Normalised tracking number |
| `carrier` | `string` | Carrier name |
| `status` | `string` | Human-readable status |
| `delivered` | `boolean` | Whether the package has been delivered |
| `last_update` | `string \| null` | ISO-8601 timestamp of last update |
| `description` | `string \| null` | Optional location / description |
| (any extra fields) | `unknown` | Provider-specific metadata |

---

## The `CarrierStatusPlugin` interface

An external status provider is an ESM module that exports a `register` function:

```ts
import type { CarrierStatusPlugin, StatusProviderRegistry } from '@openclaw/package-tracking-core';

export const register: CarrierStatusPlugin['register'] = (registry) => {
  registry.register(myProvider);
};
```

---

## Config format

In your OpenClaw plugin config (wherever `package-tracking` is configured), add:

```json
{
  "plugin": "package-tracking",
  "config": {
    "status_providers": [
      "/absolute/path/to/my-carrier-plugin/dist/index.js"
    ]
  }
}
```

Each path must point to a compiled ESM `.js` file exporting `register`.

---

## Minimal example

### Package structure

```
my-carrier-plugin/
  package.json
  tsconfig.json
  src/
    index.ts
```

**`package.json`**:
```json
{
  "name": "my-carrier-plugin",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": { "build": "tsc" },
  "devDependencies": {
    "@openclaw/package-tracking-core": "file:../../openclaw-hub/libs/ts/package_tracking_core",
    "typescript": "^6"
  }
}
```

**`tsconfig.json`**:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "strict": true
  },
  "include": ["src"]
}
```

**`src/index.ts`**:
```ts
import type { CarrierStatusPlugin, CarrierStatusResult } from '@openclaw/package-tracking-core';

export const register: CarrierStatusPlugin['register'] = (registry) => {
  registry.register({
    name: 'MyCarrier',
    carriers: ['MyCarrier'],
    async getStatus(trackingNumber): Promise<CarrierStatusResult | null> {
      // Replace with real API call
      return {
        tracking_number: trackingNumber,
        carrier: 'MyCarrier',
        status: 'In Transit',
        delivered: false,
        last_update: null,
        description: null,
      };
    },
  });
};
```

### Build & wire up

```sh
cd my-carrier-plugin
npm install
npm run build
```

Then add to plugin config and restart OpenClaw.

---

## The `get_package_status` tool

Once a provider is registered the `get_package_status` tool becomes useful:

```
get_package_status(tracking_number="1Z999AA10123456784")
get_package_status(tracking_number="1Z999AA10123456784", carrier="UPS")
```

Returns the `CarrierStatusResult` or an error if no provider handles the carrier.

---

## Priority

Providers are checked in registration order (last registered = first checked). If a provider
returns `null` or throws, the next matching provider is tried.

---

## Security note

> ⚠️ Status provider plugins run with the same privileges as the OpenClaw gateway process. Only
> load plugins from paths you trust.

---

## Built-in provider: Camoufox Scraper

The `@openclaw/camoufox-status-provider` package provides a universal scraper-based
provider that handles **USPS**, **FedEx**, and **UPS** using
[Camoufox](https://github.com/nichochar/camoufox) — a stealth Firefox fork that
bypasses bot detection (Akamai, etc.) on carrier websites.

### Prerequisites

```bash
pip3 install camoufox
camoufox fetch
```

### Wiring it up

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

See [`libs/ts/camoufox_status_provider/README.md`](../../camoufox_status_provider/README.md)
for full details, architecture, and how to add new carriers.
