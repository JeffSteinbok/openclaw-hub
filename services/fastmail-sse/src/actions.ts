/**
 * Action registration — built-in + USPS actions.
 */

import type { ActionRegistry, MailEnvelope } from "@openclaw/mail-runtime-core";
import {
  registerBuiltinActions,
  loadTrackingClient,
} from "@openclaw/mail-runtime-core";
import { registerUspsActions } from "@openclaw/mail-action-usps";
import type { AccountConfig } from "./config.js";

export function registerActions(
  registry: ActionRegistry,
  accountConfig: Record<string, AccountConfig>,
  accountIds: string[],
  inboxIds: string[],
  mailboxNames: Record<string, string>,
): void {
  registerBuiltinActions(registry, {
    mailboxPrefixResolver: (envelope: MailEnvelope) =>
      mailboxPrefix(envelope, accountConfig, accountIds, inboxIds, mailboxNames),
    accountLabelResolver: (envelope: MailEnvelope) =>
      accountConfig[envelope.account_id]?.label ??
      envelope.account_id.slice(0, 8),
    trackingClientLoader: loadTrackingClient,
  });

  registerUspsActions(registry);
}

function mailboxPrefix(
  envelope: MailEnvelope,
  accountConfig: Record<string, AccountConfig>,
  accountIds: string[],
  inboxIds: string[],
  mailboxNames: Record<string, string>,
): string {
  const accountLabel =
    accountConfig[envelope.account_id]?.label ??
    envelope.account_id.slice(0, 8);
  if (accountLabel && accountIds.length > 1) {
    return `[${accountLabel}] `;
  }
  if (inboxIds.length > 1 && envelope.mailbox_id) {
    const mailboxName =
      mailboxNames[envelope.mailbox_id] ??
      envelope.mailbox_id.slice(0, 8);
    return `[${mailboxName}] `;
  }
  return "";
}
