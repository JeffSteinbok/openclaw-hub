/**
 * Shared mail pipeline runtime: envelopes, rules, actions, and dispatch.
 * TS port of mail_runtime_core/runtime.py
 */
export interface AttachmentMeta {
    name: string;
    content_type: string;
    is_inline?: boolean;
    content_id?: string | null;
}
export interface AuthResults {
    /** "pass" | "fail" | "none" — result of DKIM verification */
    dkim?: string;
    /** "pass" | "fail" | "none" — result of SPF verification */
    spf?: string;
    /** "pass" | "fail" | "none" — result of DMARC verification */
    dmarc?: string;
    /** Raw Authentication-Results header value */
    raw?: string;
}
export interface MailEnvelope {
    message_id: string;
    provider: string;
    account_id: string;
    mailbox_id: string | null;
    sender_name: string;
    sender_email: string;
    subject: string;
    received_at?: string | null;
    body_text?: string | null;
    body_html?: string | null;
    headers?: Record<string, string>;
    has_attachments?: boolean;
    auth_results?: AuthResults;
    raw?: Record<string, unknown>;
}
export interface ActionResult {
    kind: string;
    payload: Record<string, unknown>;
}
export interface MailProviderClient {
    fetchBody(envelope: MailEnvelope): MailEnvelope | Promise<MailEnvelope>;
    listAttachments(envelope: MailEnvelope): AttachmentMeta[] | Promise<AttachmentMeta[]>;
    downloadAttachments(envelope: MailEnvelope, outputDir: string, options?: {
        content_types?: string[] | null;
        inline_only?: boolean | null;
        include_body_html?: boolean;
    }): string[] | Promise<string[]>;
}
export interface ActionContext {
    envelope: MailEnvelope;
    provider_client: MailProviderClient;
    workspace: string;
    logger: (msg: string) => void;
    config: Record<string, unknown>;
    artifacts: Record<string, unknown>;
}
export interface RegisteredAction {
    name: string;
    handler: (ctx: ActionContext, params: Record<string, unknown>) => ActionResult[] | Promise<ActionResult[]>;
    needs_body: boolean;
    attachment_request: Record<string, unknown> | null;
}
export declare function normalizeAction(action: string | Record<string, unknown>): [string, Record<string, unknown>];
/**
 * Interface for external action plugin modules loaded dynamically at startup.
 * Any ESM module exporting a `register` function satisfies this interface.
 *
 * @example
 * // my-action-plugin/src/index.ts
 * import type { ActionPlugin, ActionRegistry } from '@openclaw/mail-runtime-core';
 * export const register: ActionPlugin['register'] = (registry) => {
 *   registry.register('my_custom_action', async (ctx, params) => { ... });
 * };
 */
export interface ActionPlugin {
    register(registry: ActionRegistry): void | Promise<void>;
}
export declare class ActionRegistry {
    private _actions;
    register(name: string, handler: RegisteredAction["handler"], options?: {
        needs_body?: boolean;
        attachment_request?: Record<string, unknown> | null;
    }): void;
    get(name: string): RegisteredAction;
}
export declare function ruleMatches(envelope: MailEnvelope, rule: Record<string, unknown>): boolean;
export declare function selectMatchingRules(envelope: MailEnvelope, rules: Record<string, unknown>[]): Record<string, unknown>[];
export declare function executeRules(envelope: MailEnvelope, rules: Record<string, unknown>[], registry: ActionRegistry, providerClient: MailProviderClient, options: {
    workspace: string;
    logger: (msg: string) => void;
    config?: Record<string, unknown>;
}): Promise<[Record<string, unknown>[], ActionResult[]]>;
