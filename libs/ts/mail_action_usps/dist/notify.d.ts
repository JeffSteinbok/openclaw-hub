/**
 * Notification routing for USPS mail alerts.
 *
 * Routes notifications to different recipients based on the addressee.
 * Config lives at ~/.openclaw/agents/mail/workspace/usps-mail/config.json.
 * Notifications are planned first, then optionally delivered via `openclaw message send`.
 */
/**
 * Load plugin config (routing, etc.).
 */
export declare function loadConfig(workspaceAgent?: string): Record<string, unknown>;
/**
 * Determine routing key from addressee name.
 */
export declare function classifyRecipient(addressee: string | null | undefined): string;
/**
 * Send a notification via openclaw message send.
 */
export declare function sendMessage(message: string, channel: string, target: string): boolean;
export interface NotificationEntry {
    recipient: string;
    target: string;
    channel: string;
    message: string;
    items: Array<Record<string, unknown>>;
    sent?: boolean;
}
/**
 * Build per-recipient USPS notification payloads without sending them.
 */
export declare function buildNotificationPlan(dateStr: string, items: Array<Record<string, unknown>>, options?: {
    config?: Record<string, unknown>;
    workspaceAgent?: string;
}): NotificationEntry[];
/**
 * Route important items to the right recipients and send notifications.
 */
export declare function routeAndNotify(dateStr: string, items: Array<Record<string, unknown>>, options?: {
    dryRun?: boolean;
    workspaceAgent?: string;
}): NotificationEntry[];
