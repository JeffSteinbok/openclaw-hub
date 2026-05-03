/**
 * Re-exports from @openclaw/mail-action-usps rules module.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rulesPath = require.resolve("@openclaw/mail-action-usps/dist/rules.js");
const mod = await import(rulesPath);

export const addRule: typeof mod.addRule = mod.addRule;
export const removeRule: typeof mod.removeRule = mod.removeRule;
export const testRule: typeof mod.testRule = mod.testRule;
export const listRules: typeof mod.listRules = mod.listRules;
