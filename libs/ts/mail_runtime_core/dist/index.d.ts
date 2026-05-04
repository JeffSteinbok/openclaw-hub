export { type AttachmentMeta, type MailEnvelope, type ActionResult, type MailProviderClient, type ActionContext, type RegisteredAction, ActionRegistry, normalizeAction, ruleMatches, selectMatchingRules, executeRules, } from "./runtime.js";
export { type TrackingClient, DELIVERY_KEYWORDS, isDeliveryNotification, loadTrackingClient, scanAndAddPackages, scanAndRemoveDelivered, } from "./package-tracking.js";
export { formatMessage, buildNotifyEmailAction, buildDetectTrackingAction, registerBuiltinActions, } from "./builtin-actions.js";
export { dispatchResults } from "./result-dispatch.js";
