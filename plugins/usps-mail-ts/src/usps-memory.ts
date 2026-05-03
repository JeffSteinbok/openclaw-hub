/**
 * Re-exports from @openclaw/mail-action-usps memory module.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const memoryPath = require.resolve("@openclaw/mail-action-usps/dist/memory.js");
const mod = await import(memoryPath);

export const lookup: typeof mod.lookup = mod.lookup;
export const getStats: typeof mod.getStats = mod.getStats;
export const loadState: typeof mod.loadState = mod.loadState;
