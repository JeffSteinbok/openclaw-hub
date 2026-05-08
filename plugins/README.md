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

## Handler extraction pattern

For plugins that also serve as standalone CLIs, we separate pure business logic from the plugin wiring:

```
plugins/<name>/
├── src/
│   ├── handlers.ts        # Pure functions — accepts typed config, returns results
│   ├── index.ts           # Plugin shim — builds config from pluginConfig, delegates to handlers
│   └── adapter.ts         # Gateway adapter (unchanged)
├── dist/
│   ├── bin/
│   │   └── <name>.js      # Auto-generated CLI entry (gitignored)
│   ├── handlers.js
│   ├── index.js
│   └── adapter.js
```

### `src/handlers.ts`

Contains pure business logic that neither knows about the gateway nor the CLI:

```ts
export interface MyPluginConfig {
  apiKey?: string;
}

export interface MyResult {
  data: string;
}

export async function doSomething(config: MyPluginConfig, input: string): Promise<MyResult> {
  // Pure logic — easily testable, no framework deps
}
```

### `src/index.ts` (updated)

Thin shim that builds config from `pluginConfig` and registers tools:

```ts
import { doSomething, MyPluginConfig } from "./handlers.js";

export function createEntry() {
  return {
    id: "my-plugin",
    name: "My Plugin",
    description: "What it does",
    configSchema: {
      properties: {
        apiKey: { type: "string", description: "API key for the service" },
      },
    },
    register(api: PluginApi) {
      const config: MyPluginConfig = {
        apiKey: api.pluginConfig?.apiKey as string,
      };

      api.registerTool({
        name: "my_tool",
        description: "Does something",
        parameters: {
          type: "object",
          properties: { input: { type: "string", description: "The input" } },
          required: ["input"],
        },
        async execute(_id, params) {
          return doSomething(config, params.input as string);
        },
      });
    },
  };
}
```

## CLI generation

Every plugin can also be used as a standalone CLI tool — **without writing any CLI-specific code**. The `@openclaw/cli-shared` library introspects `createEntry()` metadata and generates a CLI entry point at build time.

### How it works

1. **Build time**: `generate-cli` imports `createEntry()`, calls `register()` to capture tool definitions, and emits a one-liner into `dist/bin/<name>.js`
2. **Run time**: The generated file calls `run()` from `@openclaw/cli-shared` which:
   - Maps each registered tool → a subcommand
   - Maps Typebox parameter schemas → positional args and `--flags`
   - Maps `configSchema` fields → environment variables (e.g., `STOCK_QUOTES_FINNHUB_API_KEY`)
   - Provides `--help`, `--json`, pretty-printed output, and proper exit codes

### Setup per plugin

**1. Add `handlers.ts` to tsup entry:**

```ts
export default defineConfig({
  entry: ["src/index.ts", "src/adapter.ts", "src/handlers.ts"],
  // ...
});
```

**2. Add `bin` and build script to `package.json`:**

```json
{
  "bin": {
    "my-plugin": "./dist/bin/my-plugin.js"
  },
  "scripts": {
    "build": "tsup && generate-cli --entry ./dist/index.js --out ./dist/bin"
  },
  "devDependencies": {
    "@openclaw/cli-shared": "file:../../libs/ts/cli_shared"
  }
}
```

**3. Build and run:**

```bash
npm run build
node dist/bin/my-plugin.js --help
```

### Config via environment variables

When running as a CLI, config comes from env vars instead of `openclaw.json`. The convention is:

```
<PLUGIN_PREFIX>_<FIELD_NAME_IN_SCREAMING_SNAKE>
```

For example, `stock-quotes` with `configSchema.properties.finnhubApiKey`:
- Env var: `STOCK_QUOTES_FINNHUB_API_KEY`

### Tool → Subcommand mapping

| Tool name         | CLI subcommand | Description |
|-------------------|----------------|-------------|
| `stock_quote`     | `stock-quote`  | Underscores become hyphens |
| `stock_quotes`    | `stock-quotes` | Same convention |

Positional args are derived from `parameters.required`. Array-typed params consume all remaining positional arguments.

## Checklist for new TS plugins

- [ ] `src/adapter.ts` exists and follows the pattern above
- [ ] `src/handlers.ts` exports pure functions (if CLI support desired)
- [ ] `openclaw.plugin.json` has `"entry": "./dist/adapter.js"`
- [ ] `package.json` has `"openclaw": { "extensions": ["./dist/adapter.js"] }`
- [ ] `package.json` has `"bin"` field (if CLI support desired)
- [ ] `tsup.config.ts` entry array includes `src/index.ts`, `src/adapter.ts`, and `src/handlers.ts`
- [ ] `npm run build` produces `dist/adapter.js`, `dist/index.js`, and `dist/bin/<name>.js`
- [ ] `npm test` passes
