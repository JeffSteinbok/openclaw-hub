/**
 * Action registration — built-in + tracking + USPS actions.
 */

import type { ActionRegistry, MailEnvelope } from "carapace-mail-runtime";
import { registerBuiltinActions } from "carapace-mail-runtime";
import { registerDetectTracking } from "carapace-package-tracking/mail-action";
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
  });

  registerDetectTracking(registry, {
    accountLabelResolver: (envelope: MailEnvelope) =>
      accountConfig[envelope.account_id]?.label ??
      envelope.account_id.slice(0, 8),
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
