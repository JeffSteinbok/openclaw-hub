/**
 * Shared built-in mail actions.
 * TS port of mail_runtime_core/builtin_actions.py
 */
import type { TrackingClient } from "./package-tracking.js";
import type { ActionContext, ActionResult, MailEnvelope } from "./runtime.js";
import { ActionRegistry } from "./runtime.js";
export declare function formatMessage(senderStr: string, senderEmail: string, subject: string): string | null;
export declare function buildNotifyEmailAction(options: {
    mailboxPrefixResolver: (envelope: MailEnvelope) => string;
}): (ctx: ActionContext, params: Record<string, unknown>) => ActionResult[];
export declare function buildDetectTrackingAction(options: {
    accountLabelResolver: (envelope: MailEnvelope) => string;
    trackingClientLoader?: () => TrackingClient;
}): (ctx: ActionContext, params: Record<string, unknown>) => Promise<ActionResult[]>;
export declare function registerBuiltinActions(registry: ActionRegistry, options: {
    mailboxPrefixResolver: (envelope: MailEnvelope) => string;
    accountLabelResolver: (envelope: MailEnvelope) => string;
    trackingClientLoader?: () => TrackingClient;
}): void;
