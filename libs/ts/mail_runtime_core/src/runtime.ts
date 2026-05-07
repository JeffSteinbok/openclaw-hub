/**
 * Shared mail pipeline runtime: envelopes, rules, actions, and dispatch.
 * TS port of mail_runtime_core/runtime.py
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  downloadAttachments(
    envelope: MailEnvelope,
    outputDir: string,
    options?: {
      content_types?: string[] | null;
      inline_only?: boolean | null;
      include_body_html?: boolean;
    },
  ): string[] | Promise<string[]>;
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

// ---------------------------------------------------------------------------
// normalizeAction
// ---------------------------------------------------------------------------

export function normalizeAction(
  action: string | Record<string, unknown>,
): [string, Record<string, unknown>] {
  if (typeof action === "string") {
    return [action, {}];
  }
  return [action["name"] as string, (action["params"] as Record<string, unknown>) ?? {}];
}

// ---------------------------------------------------------------------------
// ActionPlugin
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ActionRegistry
// ---------------------------------------------------------------------------

export class ActionRegistry {
  private _actions: Map<string, RegisteredAction> = new Map();

  register(
    name: string,
    handler: RegisteredAction["handler"],
    options?: { needs_body?: boolean; attachment_request?: Record<string, unknown> | null },
  ): void {
    this._actions.set(name, {
      name,
      handler,
      needs_body: options?.needs_body ?? false,
      attachment_request: options?.attachment_request ?? null,
    });
  }

  get(name: string): RegisteredAction {
    const action = this._actions.get(name);
    if (!action) {
      throw new Error(`Unknown mail action: ${name}`);
    }
    return action;
  }
}

// ---------------------------------------------------------------------------
// Rule matching helpers
// ---------------------------------------------------------------------------

function toList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return [value];
}

function matchesAnyExact(actual: string, expected: unknown): boolean {
  const actualLow = (actual ?? "").toLowerCase();
  return toList(expected).some((item) => actualLow === String(item).toLowerCase());
}

function matchesAnyContains(actual: string, expected: unknown): boolean {
  const actualLow = (actual ?? "").toLowerCase();
  return toList(expected).some((item) => actualLow.includes(String(item).toLowerCase()));
}

function matchesAnyPrefix(actual: string, expected: unknown): boolean {
  const actualLow = (actual ?? "").toLowerCase();
  return toList(expected).some((item) => actualLow.startsWith(String(item).toLowerCase()));
}

function senderDomain(senderEmail: string): string {
  if (!(senderEmail ?? "").includes("@")) return "";
  return senderEmail.split("@", 2)[1].toLowerCase();
}

function matchesAnyDomain(actual: string, expected: unknown): boolean {
  const actualLow = (actual ?? "").toLowerCase();
  for (const item of toList(expected)) {
    const wanted = String(item).toLowerCase();
    if (actualLow === wanted || actualLow.endsWith("." + wanted)) return true;
  }
  return false;
}

function bodyText(envelope: MailEnvelope): string {
  return [envelope.body_text, envelope.body_html].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// ruleMatches
// ---------------------------------------------------------------------------

export function ruleMatches(
  envelope: MailEnvelope,
  rule: Record<string, unknown>,
): boolean {
  if (rule["providers"] && !matchesAnyExact(envelope.provider, rule["providers"])) return false;
  if (rule["accounts"] && !matchesAnyExact(envelope.account_id, rule["accounts"])) return false;
  if (rule["mailboxes"] && !matchesAnyExact(envelope.mailbox_id ?? "", rule["mailboxes"])) return false;

  const match = (rule["match"] as Record<string, unknown>) ?? {};
  if (Object.keys(match).length === 0) return true;

  let body: string | null = null;

  for (const [key, expected] of Object.entries(match)) {
    switch (key) {
      case "sender_email":
        if (!matchesAnyExact(envelope.sender_email, expected)) return false;
        break;
      case "sender_domain":
        if (!matchesAnyDomain(senderDomain(envelope.sender_email), expected)) return false;
        break;
      case "sender_name_contains":
        if (!matchesAnyContains(envelope.sender_name, expected)) return false;
        break;
      case "subject":
        if (!matchesAnyExact(envelope.subject, expected)) return false;
        break;
      case "subject_contains":
        if (!matchesAnyContains(envelope.subject, expected)) return false;
        break;
      case "subject_prefix":
        if (!matchesAnyPrefix(envelope.subject, expected)) return false;
        break;
      case "subject_regex": {
        const patterns = toList(expected);
        if (!patterns.some((p) => new RegExp(String(p), "i").test(envelope.subject ?? "")))
          return false;
        break;
      }
      case "body_contains":
        if (body === null) body = bodyText(envelope);
        if (!matchesAnyContains(body, expected)) return false;
        break;
      case "has_attachments":
        if (Boolean(expected) !== Boolean(envelope.has_attachments)) return false;
        break;
      case "dkim_pass": {
        const dkimResult = (envelope.auth_results?.dkim ?? "none").toLowerCase();
        const wantPass = Boolean(expected);
        if (wantPass !== (dkimResult === "pass")) return false;
        break;
      }
      case "spf_pass": {
        const spfResult = (envelope.auth_results?.spf ?? "none").toLowerCase();
        const wantPass = Boolean(expected);
        if (wantPass !== (spfResult === "pass")) return false;
        break;
      }
      case "dmarc_pass": {
        const dmarcResult = (envelope.auth_results?.dmarc ?? "none").toLowerCase();
        const wantPass = Boolean(expected);
        if (wantPass !== (dmarcResult === "pass")) return false;
        break;
      }
      default:
        throw new Error(`Unsupported mail rule condition: ${key}`);
        break;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// selectMatchingRules
// ---------------------------------------------------------------------------

export function selectMatchingRules(
  envelope: MailEnvelope,
  rules: Record<string, unknown>[],
): Record<string, unknown>[] {
  const matches: Record<string, unknown>[] = [];
  for (const rule of rules) {
    if ((rule["enabled"] ?? true) === false) continue;
    if (ruleMatches(envelope, rule)) {
      matches.push(rule);
      if (!rule["continue"]) break;
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// executeRules
// ---------------------------------------------------------------------------

export async function executeRules(
  envelope: MailEnvelope,
  rules: Record<string, unknown>[],
  registry: ActionRegistry,
  providerClient: MailProviderClient,
  options: {
    workspace: string;
    logger: (msg: string) => void;
    config?: Record<string, unknown>;
  },
): Promise<[Record<string, unknown>[], ActionResult[]]> {
  const { workspace, logger, config } = options;
  mkdirSync(workspace, { recursive: true });
  const matched = selectMatchingRules(envelope, rules);
  const results: ActionResult[] = [];

  if (matched.length > 0) {
    logger(
      "matched mail rule(s): " +
        matched.map((r) => (r["id"] as string) ?? "<unnamed>").join(", ") +
        ` | sender=${envelope.sender_email} | subject=${envelope.subject}`,
    );
  }

  for (const rule of matched) {
    const actions = (rule["actions"] as unknown[]) ?? [];
    for (const actionCfg of actions) {
      const [actionName, params] = normalizeAction(actionCfg as string | Record<string, unknown>);
      const action = registry.get(actionName);
      logger(`running mail action ${actionName} for rule ${(rule["id"] as string) ?? "<unnamed>"}`);

      const ctx: ActionContext = {
        envelope: { ...envelope },
        provider_client: providerClient,
        workspace,
        logger,
        config: config ?? {},
        artifacts: {},
      };

      let tempDir: string | null = null;

      if (action.needs_body) {
        ctx.envelope = await providerClient.fetchBody(ctx.envelope);
      }

      if (action.attachment_request) {
        tempDir = mkdtempSync(join(workspace, `mail-${actionName}-`));
        const request = { ...action.attachment_request };
        const downloaded = await providerClient.downloadAttachments(ctx.envelope, tempDir, {
          content_types: (request["content_types"] as string[]) ?? undefined,
          inline_only: (request["inline_only"] as boolean) ?? undefined,
          include_body_html: (request["include_body_html"] as boolean) ?? false,
        });
        ctx.artifacts["download_dir"] = tempDir;
        ctx.artifacts["downloaded_files"] = downloaded;
        logger(`downloaded ${downloaded.length} artifact(s) for action ${actionName}`);
      }

      try {
        const actionResults = (await action.handler(ctx, params)) ?? [];
        results.push(...actionResults);
      } finally {
        if (tempDir && !params["keep_downloads"]) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
    }
  }

  return [matched, results];
}
