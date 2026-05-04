/**
 * Main entry point — loads config, registers actions, starts SSE stream.
 */

import { ActionRegistry } from "@openclaw/mail-runtime-core";
import {
  log,
  requireEnv,
  getToken,
  loadRuntimeConfig,
  buildPipelineRules,
  RECONNECT_DELAY,
} from "./config.js";
import { getMailboxNames } from "./jmap.js";
import { registerActions } from "./actions.js";
import { stream } from "./stream.js";

// Re-exports for testing
export {
  log,
  requireEnv,
  getToken,
  loadRuntimeConfig,
  buildPipelineRules,
} from "./config.js";
export { jmap, getJmapSession, fetchNewEmails, markAsRead, getMailboxNames } from "./jmap.js";
export { getEmailBodyText, getEmailBodyHtml, emailToEnvelope } from "./email.js";
export { FastmailProviderClient } from "./provider.js";
export { deliver, handoffToAgent, dispatchResults } from "./dispatch.js";
export { loadState, saveState } from "./state.js";
export { registerActions } from "./actions.js";
export { stream } from "./stream.js";
export { formatMessage } from "@openclaw/mail-runtime-core";

export async function main(): Promise<void> {
  const runtimeConfig = loadRuntimeConfig();
  const accountConfig = runtimeConfig.accounts;
  if (!accountConfig || Object.keys(accountConfig).length === 0) {
    console.error("ERROR: No accounts defined in config");
    process.exit(1);
  }
  const accountIds = Object.keys(accountConfig);
  const pipelineRules = buildPipelineRules(runtimeConfig);
  const registry = new ActionRegistry();

  const notifyTarget = requireEnv("NOTIFY_TARGET");
  const notifyChannel = process.env["NOTIFY_CHANNEL"] ?? "discord";

  // Support FASTMAIL_INBOX_IDS (comma-separated) or FASTMAIL_INBOX_ID (legacy single)
  let inboxIds: string[];
  const inboxIdsStr = process.env["FASTMAIL_INBOX_IDS"];
  if (inboxIdsStr) {
    inboxIds = inboxIdsStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else {
    const inboxId = process.env["FASTMAIL_INBOX_ID"];
    if (!inboxId) {
      console.error(
        "ERROR: FASTMAIL_INBOX_IDS or FASTMAIL_INBOX_ID is not set.",
      );
      process.exit(1);
    }
    inboxIds = [inboxId.trim()];
  }

  const token = getToken();

  // Fetch mailbox names for display
  const mailboxNames: Record<string, string> = {};
  for (const acctId of accountIds) {
    const names = await getMailboxNames(token, acctId, inboxIds);
    Object.assign(mailboxNames, names);
  }

  registerActions(registry, accountConfig, accountIds, inboxIds, mailboxNames);

  // Display startup config
  log(`config: channel=${notifyChannel}, target=${notifyTarget.slice(0, 6)}...`);
  log(`monitoring ${accountIds.length} account(s):`);
  for (const acctId of accountIds) {
    const label = accountConfig[acctId].label ?? acctId.slice(0, 8);
    log(`  • ${label} (${acctId.slice(0, 8)})`);
  }
  if (pipelineRules.length > 0) {
    log(`compiled ${pipelineRules.length} mail pipeline rule(s)`);
  }

  const mailboxInfo = inboxIds
    .map((mid) => mailboxNames[mid] ?? mid.slice(0, 8))
    .join(", ");
  log(`monitoring ${inboxIds.length} mailbox(es): ${mailboxInfo}`);

  // Main reconnection loop
  while (true) {
    try {
      await stream(token, {
        accountIds,
        inboxIds,
        pipelineRules,
        registry,
        runtimeConfig,
        notifyChannel,
        notifyTarget,
      });
    } catch (e) {
      if (
        e instanceof Error &&
        e.message === "shutdown"
      ) {
        log("shutdown");
        break;
      }
      log(
        `connection lost: ${e} — reconnecting in ${RECONNECT_DELAY}s`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, RECONNECT_DELAY * 1000),
      );
    }
  }
}

main();
