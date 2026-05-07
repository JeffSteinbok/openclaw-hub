/**
 * OpenClaw plugin adapter.
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
    throw new Error("OpenClaw SDK loaded but did not export `definePluginEntry`. Upgrade the `openclaw` package.");
  }
  pluginEntry = sdk.definePluginEntry(createEntry());
} catch {
  pluginEntry = createEntry();
}

export default pluginEntry;
