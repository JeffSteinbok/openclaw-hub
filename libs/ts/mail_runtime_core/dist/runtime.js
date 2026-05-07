/**
 * Shared mail pipeline runtime: envelopes, rules, actions, and dispatch.
 * TS port of mail_runtime_core/runtime.py
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
// ---------------------------------------------------------------------------
// normalizeAction
// ---------------------------------------------------------------------------
export function normalizeAction(action) {
    if (typeof action === "string") {
        return [action, {}];
    }
    return [action["name"], action["params"] ?? {}];
}
// ---------------------------------------------------------------------------
// ActionRegistry
// ---------------------------------------------------------------------------
export class ActionRegistry {
    _actions = new Map();
    register(name, handler, options) {
        this._actions.set(name, {
            name,
            handler,
            needs_body: options?.needs_body ?? false,
            attachment_request: options?.attachment_request ?? null,
        });
    }
    get(name) {
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
function toList(value) {
    if (Array.isArray(value))
        return value;
    return [value];
}
function matchesAnyExact(actual, expected) {
    const actualLow = (actual ?? "").toLowerCase();
    return toList(expected).some((item) => actualLow === String(item).toLowerCase());
}
function matchesAnyContains(actual, expected) {
    const actualLow = (actual ?? "").toLowerCase();
    return toList(expected).some((item) => actualLow.includes(String(item).toLowerCase()));
}
function matchesAnyPrefix(actual, expected) {
    const actualLow = (actual ?? "").toLowerCase();
    return toList(expected).some((item) => actualLow.startsWith(String(item).toLowerCase()));
}
function senderDomain(senderEmail) {
    if (!(senderEmail ?? "").includes("@"))
        return "";
    return senderEmail.split("@", 2)[1].toLowerCase();
}
function matchesAnyDomain(actual, expected) {
    const actualLow = (actual ?? "").toLowerCase();
    for (const item of toList(expected)) {
        const wanted = String(item).toLowerCase();
        if (actualLow === wanted || actualLow.endsWith("." + wanted))
            return true;
    }
    return false;
}
function bodyText(envelope) {
    return [envelope.body_text, envelope.body_html].filter(Boolean).join(" ");
}
// ---------------------------------------------------------------------------
// ruleMatches
// ---------------------------------------------------------------------------
export function ruleMatches(envelope, rule) {
    if (rule["providers"] && !matchesAnyExact(envelope.provider, rule["providers"]))
        return false;
    if (rule["accounts"] && !matchesAnyExact(envelope.account_id, rule["accounts"]))
        return false;
    if (rule["mailboxes"] && !matchesAnyExact(envelope.mailbox_id ?? "", rule["mailboxes"]))
        return false;
    const match = rule["match"] ?? {};
    if (Object.keys(match).length === 0)
        return true;
    let body = null;
    for (const [key, expected] of Object.entries(match)) {
        switch (key) {
            case "sender_email":
                if (!matchesAnyExact(envelope.sender_email, expected))
                    return false;
                break;
            case "sender_domain":
                if (!matchesAnyDomain(senderDomain(envelope.sender_email), expected))
                    return false;
                break;
            case "sender_name_contains":
                if (!matchesAnyContains(envelope.sender_name, expected))
                    return false;
                break;
            case "subject":
                if (!matchesAnyExact(envelope.subject, expected))
                    return false;
                break;
            case "subject_contains":
                if (!matchesAnyContains(envelope.subject, expected))
                    return false;
                break;
            case "subject_prefix":
                if (!matchesAnyPrefix(envelope.subject, expected))
                    return false;
                break;
            case "subject_regex": {
                const patterns = toList(expected);
                if (!patterns.some((p) => new RegExp(String(p), "i").test(envelope.subject ?? "")))
                    return false;
                break;
            }
            case "body_contains":
                if (body === null)
                    body = bodyText(envelope);
                if (!matchesAnyContains(body, expected))
                    return false;
                break;
            case "has_attachments":
                if (Boolean(expected) !== Boolean(envelope.has_attachments))
                    return false;
                break;
            default:
                throw new Error(`Unsupported mail rule condition: ${key}`);
        }
    }
    return true;
}
// ---------------------------------------------------------------------------
// selectMatchingRules
// ---------------------------------------------------------------------------
export function selectMatchingRules(envelope, rules) {
    const matches = [];
    for (const rule of rules) {
        if ((rule["enabled"] ?? true) === false)
            continue;
        if (ruleMatches(envelope, rule)) {
            matches.push(rule);
            if (!rule["continue"])
                break;
        }
    }
    return matches;
}
// ---------------------------------------------------------------------------
// executeRules
// ---------------------------------------------------------------------------
export async function executeRules(envelope, rules, registry, providerClient, options) {
    const { workspace, logger, config } = options;
    mkdirSync(workspace, { recursive: true });
    const matched = selectMatchingRules(envelope, rules);
    const results = [];
    if (matched.length > 0) {
        logger("matched mail rule(s): " +
            matched.map((r) => r["id"] ?? "<unnamed>").join(", ") +
            ` | sender=${envelope.sender_email} | subject=${envelope.subject}`);
    }
    for (const rule of matched) {
        const actions = rule["actions"] ?? [];
        for (const actionCfg of actions) {
            const [actionName, params] = normalizeAction(actionCfg);
            const action = registry.get(actionName);
            logger(`running mail action ${actionName} for rule ${rule["id"] ?? "<unnamed>"}`);
            const ctx = {
                envelope: { ...envelope },
                provider_client: providerClient,
                workspace,
                logger,
                config: config ?? {},
                artifacts: {},
            };
            let tempDir = null;
            if (action.needs_body) {
                ctx.envelope = await providerClient.fetchBody(ctx.envelope);
            }
            if (action.attachment_request) {
                tempDir = mkdtempSync(join(workspace, `mail-${actionName}-`));
                const request = { ...action.attachment_request };
                const downloaded = await providerClient.downloadAttachments(ctx.envelope, tempDir, {
                    content_types: request["content_types"] ?? undefined,
                    inline_only: request["inline_only"] ?? undefined,
                    include_body_html: request["include_body_html"] ?? false,
                });
                ctx.artifacts["download_dir"] = tempDir;
                ctx.artifacts["downloaded_files"] = downloaded;
                logger(`downloaded ${downloaded.length} artifact(s) for action ${actionName}`);
            }
            try {
                const actionResults = (await action.handler(ctx, params)) ?? [];
                results.push(...actionResults);
            }
            finally {
                if (tempDir && !params["keep_downloads"]) {
                    rmSync(tempDir, { recursive: true, force: true });
                }
            }
        }
    }
    return [matched, results];
}
