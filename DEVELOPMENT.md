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

`package-lock.json` must list the native binaries for every platform (TypeScript 7, rollup, esbuild ship one optional package per OS/CPU). If a build fails with "Unable to resolve @typescript/typescript-…" or "Cannot find module @rollup/rollup-…", the lockfile was regenerated on one platform and lost the others; restore the missing entries rather than installing the binary with `--no-save`, which re-resolves the whole tree.

## Testing

```bash
npm test
```

Individual packages:

```bash
npm run test --workspace libs/ts/mail_action_usps
```

## Project structure

```
plugins/              OpenClaw plugins (TypeScript)
libs/ts/              Shared TypeScript libraries
services/             Long-running services (e.g. fastmail-sse)
scripts/              Build and export tooling
```

## Deploying plugins

Plugins are installed into OpenClaw as packed, managed installs rather than loaded from this checkout via `plugins.load.paths`. That keeps dev `node_modules` out of the gateway (and out of `openclaw update` snapshots).

```bash
npm run deploy -- <id>           # e.g. npm run deploy -- glances
npm run deploy -- --all
npm run deploy -- <id> --install # also run the install command
```

`scripts/deploy-plugin.mjs` builds the plugin (plus any workspace library it uses), runs `npm pack` into `out/plugin-packs/<id>.tgz`, checks the tarball contents, and prints the install command:

```bash
openclaw plugins install npm-pack:<path>/out/plugin-packs/<id>.tgz --force
```

OpenClaw installs the pack into its managed plugin root with production dependencies only. What goes into the pack is controlled by the `files` field in each plugin's `package.json` (`dist`, `openclaw.plugin.json`, `README.md`), so anything a plugin imports at runtime must be in `dependencies`, not `devDependencies`.

Dev loop: edit → `npm run deploy -- <id> --install`.

## Adding a new plugin

New plugins should be created as **standalone repos** using the [carapace-plugin-template](https://github.com/JeffSteinbok/carapace-plugin-template). See the [Carapace SDK](https://github.com/JeffSteinbok/carapace-plugin-sdk) for details.

For plugins that remain in this monorepo, add to the `workspaces` and `build:plugins` entries in `package.json`.

## Adding a new mail action

See the [Carapace Mail Runtime](https://github.com/JeffSteinbok/carapace-mail-runtime) — specifically the "Writing a custom action" section.

## Release bundles

Download the **whole release bundle** from the [latest GitHub release](https://github.com/JeffSteinbok/openclaw-hub/releases/latest).
