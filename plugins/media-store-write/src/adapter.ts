/**
 * OpenClaw plugin adapter.
 *
 * Uses synchronous createRequire (not await import) to avoid top-level await,
 * which the OpenClaw plugin loader does not support.
 *
 * openclaw is an optional peer dependency — falls back to raw entry if not installed.
 */

import { createRequire } from "node:module";
import { createEntry } from "./index.js";

const require = createRequire(import.meta.url);

let pluginEntry: unknown;

try {
  const sdk = require("openclaw/plugin-sdk/plugin-entry") as {
    definePluginEntry?: (e: unknown) => unknown;
  };
  if (typeof sdk.definePluginEntry !== "function") {
    throw new Error(
      "OpenClaw SDK loaded but did not export `definePluginEntry`. Upgrade the `openclaw` package."
    );
  }
  pluginEntry = sdk.definePluginEntry(createEntry());
} catch {
  // Peer dep not installed — fall back to raw entry (works without SDK)
  pluginEntry = createEntry();
}

export default pluginEntry;
