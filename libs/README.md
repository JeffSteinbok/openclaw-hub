# Shared Libraries

All shared libraries live in `libs/ts/` and are pure TypeScript with no Python dependencies.

## Architecture

Libraries are npm workspaces consumed by plugins and services via standard package references (e.g., `"@openclaw/mail-runtime-core": "*"`). Each lib:

- Exports compiled JS from `dist/` for runtime use
- Exports TypeScript source from `src/` for type information
- Uses the `exports` field in `package.json` to map subpaths

```jsonc
// Example package.json exports
{
  "exports": {
    ".": { "types": "./src/index.ts", "import": "./dist/index.js" },
    "./rules": { "types": "./src/rules.ts", "import": "./dist/rules.js" }
  }
}
```

## Libraries

| Library | Purpose |
|---------|---------|
| `mail_runtime_core` | Rule engine, action registry, envelope types, result dispatch. Used by `fastmail-sse` service and `usps-mail` plugin. |
| `mail_action_usps` | USPS Informed Delivery processing — digest parsing, vision analysis, memory, rules. Registered as builtin actions in the mail runtime. |
| `package_tracking_core` | Carrier detection, tracking URL generation, package storage. Used by `package-tracking` plugin and mail runtime's delivery detection. |

## Building

Libraries are built as part of the workspace:

```bash
# Build a specific lib
npm run build -w libs/ts/mail_runtime_core

# Or build everything (plugins depend on libs via workspace links)
npm run build
```

## Adding a new library

1. Create `libs/ts/<name>/` with `package.json`, `tsconfig.json`, and `src/index.ts`
2. Set `"name": "@openclaw/<name>"` in package.json
3. Add `"libs/ts/<name>"` to root `package.json` workspaces array
4. Configure `exports` to point at `dist/` for runtime, `src/` for types
5. Reference from consumers with `"@openclaw/<name>": "*"` in their dependencies
