/**
 * SSE stream connection — connect to JMAP EventSource and process changes.
 */
import { log, EVENT_URL } from "./config.js";
import { fetchNewEmails, markAsRead } from "./jmap.js";
import { emailToEnvelope } from "./email.js";
import { FastmailProviderClient } from "./provider.js";
import { loadState, saveState } from "./state.js";
import { dispatchResults } from "./dispatch.js";
import { logPipelineEvent } from "./logger.js";
import { executeRules } from "carapace-mail-runtime";
import { homedir } from "node:os";
import { join } from "node:path";
const PIPELINE_WORKSPACE = join(homedir(), ".openclaw/services/mail-runtime");
// Dedup window: skip emails we've already processed within this TTL (ms).
const DEDUP_TTL_MS = 60_000;
const recentlyProcessed = new Map();
function markProcessed(emailId) {
    recentlyProcessed.set(emailId, Date.now());
}
function wasRecentlyProcessed(emailId) {
    const ts = recentlyProcessed.get(emailId);
    if (ts == null)
        return false;
    if (Date.now() - ts > DEDUP_TTL_MS) {
        recentlyProcessed.delete(emailId);
        return false;
    }
    return true;
}
function pruneDedup() {
    const now = Date.now();
    for (const [id, ts] of recentlyProcessed) {
        if (now - ts > DEDUP_TTL_MS)
            recentlyProcessed.delete(id);
    }
}
// ── Notify (process single email) ────────────────────────────
async function notify(email, options) {
    const envelope = emailToEnvelope(email, options.accountId);
    const provider = new FastmailProviderClient(options.token, log);
    const [matched, results] = await executeRules(envelope, options.pipelineRules, options.registry, provider, {
        workspace: PIPELINE_WORKSPACE,
        logger: log,
        config: options.runtimeConfig,
    });
    logPipelineEvent(envelope, matched, results);
    dispatchResults(results, {
        channel: options.notifyChannel,
        target: options.notifyTarget,
    });
}
// ── SSE stream ───────────────────────────────────────────────
export async function stream(token, config) {
    const state = loadState();
    const emailStates = state.EmailStates ?? {};
    // Seed missing accounts from legacy single-account state
    for (const acctId of config.accountIds) {
        if (!(acctId in emailStates) && state.Email) {
            emailStates[acctId] = state.Email;
        }
    }
    for (const acctId of config.accountIds) {
        log(`connecting account ${acctId.slice(0, 8)} (previous state: ${emailStates[acctId] ?? "first run"})`);
    }
    const resp = await fetch(EVENT_URL, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "text/event-stream",
        },
    });
    if (!resp.ok || !resp.body) {
        throw new Error(`SSE connection failed: ${resp.status}`);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const rawLine of lines) {
            const line = rawLine.trimEnd();
            if (!line ||
                line.startsWith(":") ||
                line.startsWith("event:") ||
                line.startsWith("id:"))
                continue;
            if (!line.startsWith("data:"))
                continue;
            let data;
            try {
                data = JSON.parse(line.slice(5).trim());
            }
            catch {
                continue;
            }
            const changed = data["changed"] ?? {};
            let stateChanged = false;
            for (const acctId of config.accountIds) {
                const acctChanged = changed[acctId] ?? {};
                const newEmailState = acctChanged["Email"];
                if (!newEmailState)
                    continue;
                const oldState = emailStates[acctId];
                if (newEmailState === oldState)
                    continue;
                if (oldState != null) {
                    log(`state change [${acctId.slice(0, 8)}]: ${oldState} → ${newEmailState}`);
                    try {
                        const emails = await fetchNewEmails(token, acctId, oldState, config.inboxIds);
                        const fresh = emails.filter((em) => {
                            if (wasRecentlyProcessed(em.id)) {
                                log(`dedup: skipping already-processed email ${em.id.slice(0, 8)}`);
                                return false;
                            }
                            return true;
                        });
                        for (const em of fresh) {
                            markProcessed(em.id);
                            await notify(em, {
                                accountId: acctId,
                                token,
                                pipelineRules: config.pipelineRules,
                                registry: config.registry,
                                runtimeConfig: config.runtimeConfig,
                                notifyChannel: config.notifyChannel,
                                notifyTarget: config.notifyTarget,
                            });
                        }
                        await markAsRead(token, acctId, fresh.map((em) => em.id));
                        pruneDedup();
                    }
                    catch (e) {
                        log(`error fetching changes for ${acctId.slice(0, 8)}: ${e}`);
                    }
                }
                else {
                    log(`initial state [${acctId.slice(0, 8)}]: ${newEmailState}`);
                }
                emailStates[acctId] = newEmailState;
                stateChanged = true;
            }
            if (stateChanged) {
                state.EmailStates = emailStates;
                saveState(state);
            }
        }
    }
}
