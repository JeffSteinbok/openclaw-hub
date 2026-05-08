/**
 * USPS Mail — core handlers.
 * Re-exports from internal modules. No plugin/framework dependencies.
 */
export { processDigest } from "@openclaw/mail-action-usps";
export { addRule, removeRule, testRule, listRules } from "./usps-rules.js";
export { lookup, getStats, loadState } from "./usps-memory.js";

export interface UspsMailConfig {}
