# Plugin Architecture

All **TypeScript plugins** (the `-ts` variants) must follow the same structural pattern. This ensures consistent loading by the OpenClaw gateway.

## Required structure

```
plugins/<name>/
├── openclaw.plugin.json   # Plugin manifest (id, entry, configSchema, activation)
├── package.json           # Node package (must include "openclaw" field)
├── tsup.config.ts         # Build config (must include adapter.ts in entry)
├── tsconfig.json
├── src/
│   ├── index.ts           # Plugin logic — exports createEntry()
│   └── adapter.ts         # Gateway adapter — wraps createEntry() with SDK
├── dist/                  # Build output (gitignored)
│   ├── adapter.js
│   └── index.js
└── tests/
    └── index.test.ts
```

## Key files explained

### `src/index.ts`

Contains the plugin's business logic. Must export a `createEntry()` function that returns an object with `id`, `name`, and a `register(api)` method:

```ts
export function createEntry() {
  return {
    id: "my-plugin",
    name: "My Plugin",
    register(api: PluginApi) {
      api.registerTool({ ... });
    },
  };
}
```

### `src/adapter.ts`

The gateway entrypoint. Wraps `createEntry()` with the OpenClaw SDK. Every TS plugin must have this — copy from an existing plugin:

```ts
import { createRequire } from "node:module";
import { createEntry } from "./index.js";

const require = createRequire(import.meta.url);

let pluginEntry: unknown;

try {
  const sdk = require("openclaw/plugin-sdk/plugin-entry") as {
    definePluginEntry?: (e: unknown) => unknown;
  };
  if (typeof sdk.definePluginEntry !== "function") {
    throw new Error("OpenClaw SDK loaded but did not export `definePluginEntry`.");
  }
  pluginEntry = sdk.definePluginEntry(createEntry());
} catch {
  pluginEntry = createEntry();
}

export default pluginEntry;
```

### `openclaw.plugin.json`

The gateway reads this to discover the plugin. Required fields:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "What it does",
  "version": "1.0.0",
  "entry": "./dist/adapter.js",
  "configSchema": { ... },
  "activation": { "onStartup": true }
}
```

**Important:** `"entry"` must point to `./dist/adapter.js` — NOT `dist/index.js`.

### `package.json`

Must include the `"openclaw"` field:

```json
{
  "openclaw": {
    "extensions": ["./dist/adapter.js"]
  }
}
```

### `tsup.config.ts`

Must include **both** entry points:

```ts
export default defineConfig({
  entry: ["src/index.ts", "src/adapter.ts"],
  // ...
});
```

## Checklist for new TS plugins

- [ ] `src/adapter.ts` exists and follows the pattern above
- [ ] `openclaw.plugin.json` has `"entry": "./dist/adapter.js"`
- [ ] `package.json` has `"openclaw": { "extensions": ["./dist/adapter.js"] }`
- [ ] `tsup.config.ts` entry array includes both `src/index.ts` and `src/adapter.ts`
- [ ] `npm run build` produces both `dist/adapter.js` and `dist/index.js`
- [ ] `npm test` passes
