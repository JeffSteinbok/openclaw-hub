/**
 * SSE stream connection — connect to JMAP EventSource and process changes.
 */
import type { MailRule } from "./config.js";
import type { ActionRegistry } from "@openclaw/mail-runtime-core";
export declare function stream(token: string, config: {
    accountIds: string[];
    inboxIds: string[];
    pipelineRules: MailRule[];
    registry: ActionRegistry;
    runtimeConfig: Record<string, unknown>;
    notifyChannel: string;
    notifyTarget: string;
}): Promise<void>;
