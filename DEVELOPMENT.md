# Development

Guide for building, testing, and contributing to openclaw-hub.

## Prerequisites

- Node.js 20+
- npm 10+

## Building locally

```bash
npm install
npm run build
```

`npm run build` builds shared libraries first (in dependency order), then all plugins.

To build only the shared libraries:

```bash
npm run build:libs
```

To export the release bundle:

```bash
npm run export:release
```

This produces the exported bundle under `out/export/`.

### Docs satellite bundle

```bash
npm run build:docs-satellite
```

Writes `out/docs-satellite/` — the public component-detail bundle consumed by `octo-docs` when a live runtime plugin, service, or shared library is sourced from `openclaw-hub`.

## Project structure

```
plugins/              Stand-alone OpenClaw plugins (TypeScript)
libs/ts/              Shared TypeScript libraries
  package_tracking_core/   Carrier detection, tracking URLs, package storage
  mail_runtime_core/       Rule engine, action registry, result dispatch
  mail_action_usps/        USPS digest parsing, vision analysis, memory
services/             Long-running services (e.g. fastmail-sse)
scripts/              Build and export tooling (Python)
```

## Build order for libs

Libraries must be built in dependency order:

1. `package_tracking_core`
2. `mail_runtime_core`
3. `mail_action_usps`
4. `services/fastmail-sse`

The `build:libs` script handles this automatically.

## Testing

```bash
npm test
```

Runs tests across all workspaces. Individual packages can be tested with:

```bash
npm run test --workspace libs/ts/mail_runtime_core
```

Script tests (Python):

```bash
npm run test:scripts
```

## Adding a new plugin

See [`PLUGIN_README_SHAPE.md`](PLUGIN_README_SHAPE.md) for the required file layout and README conventions. See [`plugins/README.md`](plugins/README.md) for the full architecture guide.

Steps:

1. Create `plugins/<name>/` with `package.json`, `tsup.config.ts`, `src/index.ts`, `src/adapter.ts`
2. Add the workspace to the root `package.json` workspaces array
3. Add the workspace to the `build:plugins` script
4. Write a README following `PLUGIN_README_SHAPE.md`

## Adding a new mail action

See [`libs/ts/mail_runtime_core/README.md`](libs/ts/mail_runtime_core/README.md) — specifically the "Writing a custom action" section.

The `mail_action_usps` package is a complete real-world example of a mail action plugin.

## Downloading release bundles

Download the **whole release bundle** from the [latest GitHub release](https://github.com/JeffSteinbok/openclaw-hub/releases/latest).

This repo is small enough that it is easier to ship one bundle containing the exported public components than to make people choose from a long list of separate downloads.
