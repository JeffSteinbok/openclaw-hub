/**
 * Main entry point — loads config, registers actions, starts SSE stream.
 */
export { log, requireEnv, getToken, loadRuntimeConfig, buildPipelineRules, } from "./config.js";
export { jmap, getJmapSession, fetchNewEmails, markAsRead, getMailboxNames } from "./jmap.js";
export { getEmailBodyText, getEmailBodyHtml, emailToEnvelope } from "./email.js";
export { FastmailProviderClient } from "./provider.js";
export { deliver, handoffToAgent, dispatchResults } from "./dispatch.js";
export { loadState, saveState } from "./state.js";
export { registerActions } from "./actions.js";
export { stream } from "./stream.js";
export { formatMessage } from "carapace-mail-runtime";
export declare function main(): Promise<void>;
