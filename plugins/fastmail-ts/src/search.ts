/**
 * JMAP email search/read/inbox operations.
 *
 * Ported from fastmail_search.py.
 */

import { jmap, type JmapResponse } from "./jmap-client.js";

// ── Formatting helpers ──────────────────────────────────────────────────────

interface EmailAddress {
  name?: string;
  email?: string;
}

function formatSender(fromList: EmailAddress[] | null | undefined): string {
  if (!fromList || fromList.length === 0) return "(unknown)";
  const s = fromList[0];
  const name = s.name ?? "";
  const email = s.email ?? "";
  return name ? `${name} <${email}>` : email;
}

function formatDate(isoStr: string | null | undefined): string {
  if (!isoStr) return "";
  try {
    const dt = new Date(isoStr);
    if (isNaN(dt.getTime())) return (isoStr ?? "").slice(0, 16);
    const now = new Date();
    const sameDay =
      dt.getUTCFullYear() === now.getUTCFullYear() &&
      dt.getUTCMonth() === now.getUTCMonth() &&
      dt.getUTCDate() === now.getUTCDate();
    if (sameDay) {
      return dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
    }
    if (dt.getUTCFullYear() === now.getUTCFullYear()) {
      return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) +
        " " + dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
    }
    return dt.toISOString().slice(0, 10);
  } catch {
    return (isoStr ?? "").slice(0, 16);
  }
}

interface EmailSummary {
  id: string;
  from: EmailAddress[];
  subject: string;
  receivedAt: string;
  keywords: Record<string, boolean>;
}

function formatEmailList(emails: EmailSummary[]): string {
  if (emails.length === 0) return "No emails found.";
  const lines: string[] = [];
  for (const e of emails) {
    const sender = formatSender(e.from);
    const date = formatDate(e.receivedAt);
    const subject = (e.subject ?? "(no subject)").slice(0, 80);
    const eid = e.id ?? "?";
    const read = e.keywords?.["$seen"] ? " " : "•";
    lines.push(`${read} ${date.padStart(12)}  ${sender.slice(0, 35).padEnd(35)}  ${subject}`);
    lines.push(`  ID: ${eid}`);
  }
  return lines.join("\n");
}

interface EmailDetail {
  id: string;
  from: EmailAddress[];
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  receivedAt: string;
  textBody: Array<{ partId?: string }>;
  bodyValues: Record<string, { value?: string }>;
  preview: string;
}

function formatEmailDetail(email: EmailDetail): string {
  const sender = formatSender(email.from);
  const toList = email.to ?? [];
  const toStr = toList
    .map((t) => `${t.name ?? ""} <${t.email ?? ""}>`.trim())
    .join(", ");
  const ccList = email.cc ?? [];
  const ccStr = ccList
    .map((c) => `${c.name ?? ""} <${c.email ?? ""}>`.trim())
    .join(", ");
  const subject = email.subject ?? "(no subject)";

  const lines: string[] = [
    `Subject: ${subject}`,
    `From:    ${sender}`,
    `To:      ${toStr}`,
  ];
  if (ccStr) lines.push(`Cc:      ${ccStr}`);
  lines.push(`Date:    ${email.receivedAt ?? ""}`);
  lines.push(`ID:      ${email.id ?? "?"}`);
  lines.push("-".repeat(60));

  const body = email.textBody ?? [{}];
  if (body.length > 0 && body[0].partId) {
    const partId = body[0].partId;
    const bv = (email.bodyValues ?? {})[partId] ?? {};
    lines.push(bv.value ?? "(no text body)");
  } else {
    lines.push(email.preview ?? "(no preview)");
  }

  return lines.join("\n");
}

// ── JMAP helper ─────────────────────────────────────────────────────────────

async function getInboxId(token: string, accountId: string): Promise<string> {
  const resp = await jmap(
    token,
    [
      [
        "Mailbox/get",
        {
          accountId,
          properties: ["name", "id", "role"],
        },
        "mbox",
      ],
    ],
    ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
  );
  const list = (resp.methodResponses[0][1].list as Array<{ id: string; role?: string }>) ?? [];
  for (const mb of list) {
    if (mb.role === "inbox") return mb.id;
  }
  throw new Error("Could not find Inbox mailbox");
}

// ── Commands ────────────────────────────────────────────────────────────────

export interface InboxArgs {
  limit?: number;
  unread?: boolean;
}

export async function cmdInbox(
  token: string,
  accountId: string,
  args: InboxArgs,
): Promise<string> {
  const inboxId = await getInboxId(token, accountId);
  const filterObj: Record<string, unknown> = { inMailbox: inboxId };
  if (args.unread) {
    filterObj.notKeyword = "$seen";
  }

  const resp = await jmap(
    token,
    [
      [
        "Email/query",
        {
          accountId,
          filter: filterObj,
          sort: [{ property: "receivedAt", isAscending: false }],
          limit: args.limit ?? 10,
        },
        "q",
      ],
      [
        "Email/get",
        {
          accountId,
          "#ids": { resultOf: "q", name: "Email/query", path: "/ids" },
          properties: ["id", "from", "subject", "receivedAt", "keywords"],
        },
        "g",
      ],
    ],
    ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
  );

  const emails = (resp.methodResponses[1][1].list as EmailSummary[]) ?? [];
  const total = (resp.methodResponses[0][1] as Record<string, unknown>).total ?? "?";
  return `📬 Inbox (${total} total, showing ${emails.length})\n\n${formatEmailList(emails)}`;
}

export interface SearchArgs {
  query?: string;
  sender?: string;
  to?: string;
  subject?: string;
  since?: string;
  before?: string;
  limit?: number;
}

export async function cmdSearch(
  token: string,
  accountId: string,
  args: SearchArgs,
): Promise<string> {
  const filterParts: Record<string, unknown>[] = [];

  if (args.query) filterParts.push({ text: args.query });
  if (args.sender) filterParts.push({ from: args.sender });
  if (args.to) filterParts.push({ to: args.to });
  if (args.subject) filterParts.push({ subject: args.subject });
  if (args.since) filterParts.push({ after: args.since + "T00:00:00Z" });
  if (args.before) filterParts.push({ before: args.before + "T00:00:00Z" });

  const inboxId = await getInboxId(token, accountId);
  filterParts.push({ inMailbox: inboxId });

  const filterObj =
    filterParts.length === 1
      ? filterParts[0]
      : { operator: "AND", conditions: filterParts };

  const resp = await jmap(
    token,
    [
      [
        "Email/query",
        {
          accountId,
          filter: filterObj,
          sort: [{ property: "receivedAt", isAscending: false }],
          limit: args.limit ?? 20,
        },
        "q",
      ],
      [
        "Email/get",
        {
          accountId,
          "#ids": { resultOf: "q", name: "Email/query", path: "/ids" },
          properties: ["id", "from", "subject", "receivedAt", "keywords"],
        },
        "g",
      ],
    ],
    ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
  );

  const emails = (resp.methodResponses[1][1].list as EmailSummary[]) ?? [];
  const total = (resp.methodResponses[0][1] as Record<string, unknown>).total ?? "?";
  return `🔍 Search results (${total} matches, showing ${emails.length})\n\n${formatEmailList(emails)}`;
}

export async function cmdRead(
  token: string,
  accountId: string,
  emailId: string,
): Promise<string> {
  const resp = await jmap(
    token,
    [
      [
        "Email/get",
        {
          accountId,
          ids: [emailId],
          properties: [
            "id", "from", "to", "cc", "subject", "receivedAt",
            "textBody", "bodyValues", "preview", "keywords",
          ],
          fetchTextBodyValues: true,
          maxBodyValueBytes: 50000,
        },
        "g",
      ],
    ],
    ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
  );

  const emails = (resp.methodResponses[0][1].list as EmailDetail[]) ?? [];
  if (emails.length === 0) {
    const notFound = (resp.methodResponses[0][1] as Record<string, unknown>).notFound as string[] | undefined;
    if (notFound && notFound.length > 0) {
      throw new Error(`Email not found: ${emailId}`);
    }
    throw new Error("No email returned");
  }

  return formatEmailDetail(emails[0]);
}
