/**
 * Action registration — built-in + tracking + USPS actions.
 */
import { registerBuiltinActions } from "carapace-mail-runtime";
import { registerDetectTracking } from "carapace-package-tracking/mail-action";
import { registerUspsActions } from "@openclaw/mail-action-usps";
export function registerActions(registry, accountConfig, accountIds, inboxIds, mailboxNames) {
    registerBuiltinActions(registry, {
        mailboxPrefixResolver: (envelope) => mailboxPrefix(envelope, accountConfig, accountIds, inboxIds, mailboxNames),
    });
    registerDetectTracking(registry, {
        accountLabelResolver: (envelope) => accountConfig[envelope.account_id]?.label ??
            envelope.account_id.slice(0, 8),
    });
    registerUspsActions(registry);
}
function mailboxPrefix(envelope, accountConfig, accountIds, inboxIds, mailboxNames) {
    const accountLabel = accountConfig[envelope.account_id]?.label ??
        envelope.account_id.slice(0, 8);
    if (accountLabel && accountIds.length > 1) {
        return `[${accountLabel}] `;
    }
    if (inboxIds.length > 1 && envelope.mailbox_id) {
        const mailboxName = mailboxNames[envelope.mailbox_id] ??
            envelope.mailbox_id.slice(0, 8);
        return `[${mailboxName}] `;
    }
    return "";
}
