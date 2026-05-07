/**
 * JMAP HTTP client functions.
 */
import { JMAP_API, EMAIL_PROPS } from "./config.js";
import { log } from "./config.js";
// ── JMAP API call ────────────────────────────────────────────
export async function jmap(token, calls) {
    const body = JSON.stringify({
        using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
        methodCalls: calls,
    });
    const resp = await fetch(JMAP_API, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body,
    });
    if (!resp.ok) {
        throw new Error(`JMAP API error: ${resp.status} ${resp.statusText}`);
    }
    return (await resp.json());
}
// ── Session ──────────────────────────────────────────────────
export async function getJmapSession(token) {
    const resp = await fetch("https://api.fastmail.com/jmap/session", {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
        throw new Error(`JMAP session error: ${resp.status} ${resp.statusText}`);
    }
    return (await resp.json());
}
// ── Fetch new emails ─────────────────────────────────────────
export async function fetchNewEmails(token, accountId, oldState, inboxIds) {
    const result = await jmap(token, [
        [
            "Email/changes",
            { accountId, sinceState: oldState },
            "changes",
        ],
    ]);
    const changes = result.methodResponses[0][1];
    const created = changes["created"] ?? [];
    if (created.length === 0)
        return [];
    const getResult = await jmap(token, [
        [
            "Email/get",
            {
                accountId,
                ids: created.slice(0, 20),
                properties: [...EMAIL_PROPS, "mailboxIds"],
                bodyProperties: ["partId", "type"],
                fetchTextBodyValues: true,
                fetchHTMLBodyValues: true,
                maxBodyValueBytes: 50000,
            },
            "get",
        ],
    ]);
    const emails = getResult.methodResponses[0][1]["list"] ?? [];
    const monitored = new Set(inboxIds);
    const filtered = [];
    for (const e of emails) {
        const emailMailboxes = new Set(Object.keys(e.mailboxIds ?? {}));
        const intersection = [...monitored].filter((id) => emailMailboxes.has(id));
        if (intersection.length > 0) {
            e._matched_mailbox = intersection[0];
            e._account_id = accountId;
            filtered.push(e);
        }
    }
    return filtered;
}
// ── Mark as read ─────────────────────────────────────────────
export async function markAsRead(token, accountId, emailIds) {
    if (emailIds.length === 0)
        return;
    const updates = {};
    for (const eid of emailIds) {
        updates[eid] = { "keywords/$seen": true };
    }
    try {
        await jmap(token, [
            ["Email/set", { accountId, update: updates }, "mark"],
        ]);
        log(`marked ${emailIds.length} email(s) as read`);
    }
    catch (e) {
        log(`warn: failed to mark as read: ${e}`);
    }
}
// ── Mailbox names ────────────────────────────────────────────
export async function getMailboxNames(token, accountId, inboxIds) {
    try {
        const result = await jmap(token, [
            [
                "Mailbox/get",
                {
                    accountId,
                    ids: inboxIds,
                    properties: ["name", "id"],
                },
                "mbox",
            ],
        ]);
        const mailboxes = result.methodResponses[0][1]["list"] ?? [];
        const names = {};
        for (const mb of mailboxes) {
            names[mb.id] = mb.name ?? mb.id;
        }
        return names;
    }
    catch (e) {
        log(`warn: failed to fetch mailbox names for ${accountId.slice(0, 8)}: ${e}`);
        return {};
    }
}
