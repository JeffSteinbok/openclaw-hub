/**
 * Shared USPS mail action module.
 *
 * `register` is the ActionPlugin entry point, so mail services can load this
 * module from their `action_plugins` list.
 */

export { processDigest } from "./analyze.js";
export { processUspsDigestAction, registerUspsActions } from "./register.js";
export { registerUspsActions as register } from "./register.js";
