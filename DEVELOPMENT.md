# Development

## Prerequisites

- Node.js 20+
- npm 10+

## Building

```bash
npm install
npm run build
```

Builds shared libraries first (in dependency order), then all plugins.

## Testing

```bash
npm test
```

Individual packages:

```bash
npm run test --workspace libs/ts/mail_runtime_core
```

## Project structure

```
plugins/              OpenClaw plugins (TypeScript)
libs/ts/              Shared TypeScript libraries
services/             Long-running services (e.g. fastmail-sse)
scripts/              Build and export tooling
```

## Adding a new plugin

New plugins should be created as **standalone repos** using the [carapace-plugin-template](https://github.com/JeffSteinbok/carapace-plugin-template). See the [Carapace SDK](https://github.com/JeffSteinbok/carapace-plugin-sdk) for details.

For plugins that remain in this monorepo, add to the `workspaces` and `build:plugins` entries in `package.json`.

## Adding a new mail action

See [`libs/ts/mail_runtime_core/README.md`](libs/ts/mail_runtime_core/README.md) — specifically the "Writing a custom action" section.

## Release bundles

Download the **whole release bundle** from the [latest GitHub release](https://github.com/JeffSteinbok/openclaw-hub/releases/latest).
