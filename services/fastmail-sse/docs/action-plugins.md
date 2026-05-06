# fastmail-sse Action Plugins

Action plugins let you register custom mail processing actions from external packages — without
forking openclaw-hub. This is the recommended way to add private or site-specific actions (e.g.
Amazon shipment tracking, custom integrations) that live outside the public monorepo.

---

## What are actions?

When fastmail-sse receives an email it evaluates the configured `mail_rules`. Each matching rule
runs one or more **actions** — named functions that inspect the email and return zero or more
`ActionResult` objects (e.g. `notify`, `agent_handoff`, `skip`).

Built-in actions (`notify_email`, `detect_tracking`) and the USPS action (`process_usps_digest`)
are registered at startup. The plugin system extends this by letting you register additional
actions from external ESM modules.

---

## The `ActionPlugin` interface

An action plugin is any ESM module that exports a `register` function:

```ts
import type { ActionPlugin, ActionRegistry } from '@openclaw/mail-runtime-core';

export const register: ActionPlugin['register'] = async (registry) => {
  registry.register('my_action_name', async (ctx, params) => {
    // ctx.envelope — the incoming email
    // ctx.provider_client — fetch body / attachments
    // ctx.logger('...') — structured logging
    // params — action params from the mail rule config
    return [];  // return ActionResult[]
  });
};
```

The `register` function receives the shared `ActionRegistry` instance. It may be `async` if you
need to perform async setup before registration.

---

## Config format

Add an `action_plugins` array to `~/.openclaw/services/fastmail-sse-config.json`:

```json
{
  "accounts": { ... },
  "action_plugins": [
    "/absolute/path/to/my-plugin/dist/index.js"
  ],
  "mail_rules": [
    {
      "id": "my-rule",
      "match": { "sender_domain": "example.com" },
      "actions": [{ "name": "my_action_name" }]
    }
  ]
}
```

Each entry in `action_plugins` is an **absolute path** (or a path relative to the process `cwd`)
to a compiled ESM `.js` file. Plugins are loaded in order after all built-in actions are
registered, so they can safely call `registry.register(...)` without collision.

---

## Minimal example

### 1. Create the plugin package

```
my-action-plugin/
  package.json
  tsconfig.json
  src/
    index.ts
```

**`package.json`**:
```json
{
  "name": "my-action-plugin",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": { "build": "tsc" },
  "devDependencies": {
    "@openclaw/mail-runtime-core": "file:../../openclaw-hub/libs/ts/mail_runtime_core",
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
import type { ActionPlugin, ActionRegistry } from '@openclaw/mail-runtime-core';

export const register: ActionPlugin['register'] = (registry) => {
  registry.register(
    'my_custom_action',
    async (ctx, _params) => {
      ctx.logger(`my_custom_action: subject=${ctx.envelope.subject}`);
      return [];
    },
    { needs_body: false },
  );
};
```

### 2. Build

```sh
cd my-action-plugin
npm install
npm run build
```

### 3. Wire up in config

```json
{
  "action_plugins": ["/path/to/my-action-plugin/dist/index.js"],
  "mail_rules": [
    {
      "id": "my-rule",
      "match": { "sender_domain": "example.com" },
      "actions": [{ "name": "my_custom_action" }]
    }
  ]
}
```

### 4. Restart

```sh
systemctl --user restart fastmail-sse.service
```

You should see a log line like:
```
[fastmail-sse] loaded action plugin: /path/to/my-action-plugin/dist/index.js
```

---

## Build instructions summary

1. Use `"type": "module"` in `package.json` (ESM required).
2. Use `"module": "NodeNext"` and `"moduleResolution": "NodeNext"` in `tsconfig.json`.
3. All internal imports must use `.js` file extensions (ESM requirement).
4. Compile to a single `dist/index.js` or a module with a clear entry point.
5. Reference peer libs from openclaw-hub using `file:` paths in `devDependencies` so TypeScript
   can resolve types at build time. The runtime will resolve imports from the installed copies in
   the fastmail-sse `node_modules`.

---

## Security note

> ⚠️ **Action plugins run with the same privileges as fastmail-sse.** Only load plugins from
> paths you trust. Do not load plugins from network paths or untrusted third parties. Plugins
> have full access to the `ActionRegistry`, the mail `ActionContext` (including email body and
> attachments), and the Node.js process environment.

Use absolute paths in `action_plugins` to avoid ambiguity about which file is loaded.
