/**
 * JMAP HTTP client functions.
 */

import { JMAP_API, EMAIL_PROPS } from "./config.js";
import { log } from "./config.js";

// ── Types ────────────────────────────────────────────────────

export type JmapMethodCall = [string, Record<string, unknown>, string];

export interface JmapResponse {
  methodResponses: Array<[string, Record<string, unknown>, string]>;
  [key: string]: unknown;
}

export interface JmapEmail {
  id: string;
  from?: Array<{ name?: string; email?: string }>;
  subject?: string;
  receivedAt?: string;
  textBody?: Array<{ partId: string; type?: string }>;
  htmlBody?: Array<{ partId: string; type?: string }>;
  bodyValues?: Record<string, { value: string; isEncodingProblem?: boolean; isTruncated?: boolean }>;
  blobId?: string;
  mailboxIds?: Record<string, boolean>;
  _matched_mailbox?: string;
  _account_id?: string;
  [key: string]: unknown;
}

// ── JMAP API call ────────────────────────────────────────────

export async function jmap(
  token: string,
  calls: JmapMethodCall[],
): Promise<JmapResponse> {
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

  return (await resp.json()) as JmapResponse;
}

// ── Session ──────────────────────────────────────────────────

export async function getJmapSession(
  token: string,
): Promise<Record<string, unknown>> {
  const resp = await fetch("https://api.fastmail.com/jmap/session", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    throw new Error(`JMAP session error: ${resp.status} ${resp.statusText}`);
  }
  return (await resp.json()) as Record<string, unknown>;
}

// ── Fetch new emails ─────────────────────────────────────────

const GET_BATCH_SIZE = 50;
const MAX_CHANGE_PAGES = 20;

export interface NewEmailsResult {
  emails: JmapEmail[];
  /**
   * Server state after the returned changes, or null when the server can no
   * longer calculate changes from `oldState` (the caller should resync).
   */
  newState: string | null;
}

function methodArgs(
  response: JmapResponse,
  label: string,
): Record<string, unknown> | null {
  const [name, args] = response.methodResponses[0];
  if (name !== "error") return args;
  if (args["type"] === "cannotCalculateChanges") return null;
  throw new Error(`JMAP ${label} error: ${String(args["type"] ?? "unknown")}`);
}

export async function fetchNewEmails(
  token: string,
  accountId: string,
  oldState: string,
  inboxIds: string[],
): Promise<NewEmailsResult> {
  const created: string[] = [];
  let sinceState = oldState;
  for (let page = 0; page < MAX_CHANGE_PAGES; page++) {
    const result = await jmap(token, [
      [
        "Email/changes",
        { accountId, sinceState },
        "changes",
      ],
    ]);
    const changes = methodArgs(result, "Email/changes");
    if (changes === null) {
      log(`warn: cannot calculate changes for ${accountId.slice(0, 8)} since ${oldState}; resyncing`);
      return { emails: [], newState: null };
    }
    created.push(...((changes["created"] as string[]) ?? []));
    sinceState = changes["newState"] as string;
    if (!changes["hasMoreChanges"]) break;
  }

  const emails: JmapEmail[] = [];
  for (let i = 0; i < created.length; i += GET_BATCH_SIZE) {
    const getResult = await jmap(token, [
      [
        "Email/get",
        {
          accountId,
          ids: created.slice(i, i + GET_BATCH_SIZE),
          properties: [...EMAIL_PROPS, "mailboxIds"],
          bodyProperties: ["partId", "type"],
          fetchTextBodyValues: true,
          fetchHTMLBodyValues: true,
          maxBodyValueBytes: 50000,
        },
        "get",
      ],
    ]);
    const got = methodArgs(getResult, "Email/get");
    emails.push(...(((got?.["list"]) as JmapEmail[]) ?? []));
  }

  const monitored = new Set(inboxIds);
  const filtered: JmapEmail[] = [];

  for (const e of emails) {
    const emailMailboxes = new Set(
      Object.keys(e.mailboxIds ?? {}),
    );
    const intersection = [...monitored].filter((id) => emailMailboxes.has(id));
    if (intersection.length > 0) {
      e._matched_mailbox = intersection[0];
      e._account_id = accountId;
      filtered.push(e);
    }
  }

  return { emails: filtered, newState: sinceState };
}

// ── Mark as read ─────────────────────────────────────────────

export async function markAsRead(
  token: string,
  accountId: string,
  emailIds: string[],
): Promise<void> {
  if (emailIds.length === 0) return;
  const updates: Record<string, Record<string, boolean>> = {};
  for (const eid of emailIds) {
    updates[eid] = { "keywords/$seen": true };
  }
  try {
    await jmap(token, [
      ["Email/set", { accountId, update: updates }, "mark"],
    ]);
    log(`marked ${emailIds.length} email(s) as read`);
  } catch (e) {
    log(`warn: failed to mark as read: ${e}`);
  }
}

// ── Mailbox names ────────────────────────────────────────────

export async function getMailboxNames(
  token: string,
  accountId: string,
  inboxIds: string[],
): Promise<Record<string, string>> {
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
    const mailboxes = (result.methodResponses[0][1]["list"] as Array<{
      id: string;
      name?: string;
    }>) ?? [];
    const names: Record<string, string> = {};
    for (const mb of mailboxes) {
      names[mb.id] = mb.name ?? mb.id;
    }
    return names;
  } catch (e) {
    log(`warn: failed to fetch mailbox names for ${accountId.slice(0, 8)}: ${e}`);
    return {};
  }
}
