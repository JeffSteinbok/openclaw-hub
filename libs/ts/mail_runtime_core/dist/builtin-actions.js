/**
 * Shared built-in mail actions.
 * TS port of mail_runtime_core/builtin_actions.py
 */
import { isDeliveryNotification, loadTrackingClient, scanAndAddPackages, scanAndRemoveDelivered, } from "./package-tracking.js";
// ---------------------------------------------------------------------------
// formatMessage
// ---------------------------------------------------------------------------
export function formatMessage(senderStr, senderEmail, subject) {
    const low = (subject ?? "").toLowerCase();
    if (["unsubscribe", "noreply", "no-reply"].some((kw) => low.includes(kw))) {
        return null;
    }
    const responses = [
        ["accepted:", "👍", "accepted"],
        ["declined:", "👎", "declined"],
        ["tentative:", "🤷", "tentative"],
    ];
    for (const [prefix, emoji, verb] of responses) {
        if (low.startsWith(prefix)) {
            const event = subject.slice(prefix.length).trim();
            const name = senderStr.split("<")[0].trim() || senderEmail;
            return `👤 ${name} ${verb} ${emoji}: ${event}`;
        }
    }
    const name = senderStr.split("<")[0].trim() || senderEmail;
    return `📧 ${name}: ${subject}`;
}
// ---------------------------------------------------------------------------
// buildNotifyEmailAction
// ---------------------------------------------------------------------------
export function buildNotifyEmailAction(options) {
    const { mailboxPrefixResolver } = options;
    return (ctx, _params) => {
        let senderStr = ctx.envelope.sender_email;
        if (ctx.envelope.sender_name) {
            senderStr = `${ctx.envelope.sender_name} <${ctx.envelope.sender_email}>`;
        }
        const message = formatMessage(senderStr, ctx.envelope.sender_email, ctx.envelope.subject);
        if (message === null) {
            ctx.logger(`skipped: ${senderStr} — ${ctx.envelope.subject}`);
            return [];
        }
        const prefix = mailboxPrefixResolver(ctx.envelope);
        return [{ kind: "message", payload: { message: `${prefix}${message}` } }];
    };
}
// ---------------------------------------------------------------------------
// buildDetectTrackingAction
// ---------------------------------------------------------------------------
export function buildDetectTrackingAction(options) {
    const { accountLabelResolver, trackingClientLoader = loadTrackingClient } = options;
    return async (ctx, _params) => {
        if (isDeliveryNotification(ctx.envelope.subject)) {
            const removed = await scanAndRemoveDelivered(ctx.envelope, {
                logger: ctx.logger,
                trackingClientLoader,
            });
            return removed.map((trackingNumber) => ({
                kind: "message",
                payload: {
                    message: `✅ Package delivered & removed from tracking: ${trackingNumber}`,
                },
            }));
        }
        const added = await scanAndAddPackages(ctx.envelope, {
            accountLabel: accountLabelResolver(ctx.envelope),
            logger: ctx.logger,
            trackingClientLoader,
        });
        return added.map((trackingNumber) => ({
            kind: "message",
            payload: { message: `📦 Package registered: ${trackingNumber}` },
        }));
    };
}
// ---------------------------------------------------------------------------
// registerBuiltinActions
// ---------------------------------------------------------------------------
export function registerBuiltinActions(registry, options) {
    const { mailboxPrefixResolver, accountLabelResolver, trackingClientLoader = loadTrackingClient } = options;
    registry.register("notify_email", buildNotifyEmailAction({ mailboxPrefixResolver }));
    registry.register("detect_tracking", buildDetectTrackingAction({ accountLabelResolver, trackingClientLoader }), { needs_body: true });
}
