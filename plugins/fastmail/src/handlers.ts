/**
 * FastMail — core handlers.
 * Re-exports from internal modules. No plugin/framework dependencies.
 */
export type { FastmailConfig } from "./config.js";
export { resolveConfig } from "./config.js";
export { cmdInbox, cmdSearch, cmdRead } from "./search.js";
export { cmdSend, cmdMeeting, cmdUpdateEvent, cmdQueryEvents } from "./email.js";
