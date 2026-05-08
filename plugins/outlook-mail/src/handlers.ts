/**
 * Outlook Mail — core handlers.
 *
 * Pure logic with no knowledge of how it's invoked (plugin vs CLI).
 * Config is passed in; handlers never read env vars or plugin APIs directly.
 */

import https from "node:https";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OutlookMailConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpPost(url: string, body: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: "POST", headers, timeout: 30_000 }, res => {
      let data = ""; res.on("data", (c: Buffer) => data += c); res.on("end", () => resolve(data));
    });
    req.on("error", reject); req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); }); req.write(body); req.end();
  });
}

function httpGet(url: string, token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, timeout: 30_000 }, res => {
      let data = ""; res.on("data", (c: Buffer) => data += c); res.on("end", () => resolve(data));
    });
    req.on("error", reject); req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); }); req.end();
  });
}

// ---------------------------------------------------------------------------
// Token / Graph
// ---------------------------------------------------------------------------

async function getToken(clientId: string, clientSecret: string, refreshToken: string, scope = "Mail.Read"): Promise<string> {
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token", scope }).toString();
  const res = await httpPost(TOKEN_URL, body, { "Content-Type": "application/x-www-form-urlencoded" });
  const data = JSON.parse(res);
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data).slice(0, 200)}`);
  return data.access_token;
}

async function graphGet(token: string, path: string): Promise<unknown> {
  const res = await httpGet(`${GRAPH_BASE}${path}`, token);
  return JSON.parse(res);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(s: string): string { return s.replace(/'/g, "''"); }

function formatMessage(m: Record<string, unknown>, includeBody = false): Record<string, unknown> {
  const from = (m.from as Record<string, Record<string, string>>)?.emailAddress ?? {};
  const result: Record<string, unknown> = {
    id: m.id, subject: m.subject ?? "(no subject)",
    from: `${from.name ?? ""}${from.address ? ` <${from.address}>` : ""}`.trim(),
    received: String(m.receivedDateTime ?? "").slice(0, 10),
    is_read: m.isRead,
    has_attachments: m.hasAttachments,
  };
  if (includeBody) result.body_preview = (m.bodyPreview as string ?? "").slice(0, 500);
  return result;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function getInbox(
  config: OutlookMailConfig,
  params: { limit?: number; unread?: boolean; folder?: string },
): Promise<unknown> {
  const { clientId, clientSecret, refreshToken } = config;
  if (!clientId) return { error: "OUTLOOK_CLIENT_ID not set" };
  const token = await getToken(clientId, clientSecret, refreshToken);
  const limit = params.limit ?? 10;
  const folder = params.folder ?? "inbox";
  let path = `/me/mailFolders/${encodeURIComponent(folder)}/messages?$top=${limit}&$select=subject,from,receivedDateTime,isRead,hasAttachments,bodyPreview&$orderby=receivedDateTime%20desc`;
  if (params.unread) path += "&$filter=isRead%20eq%20false";
  const data = await graphGet(token, path) as { value: Array<Record<string, unknown>> };
  return { messages: (data.value ?? []).map(m => formatMessage(m, true)), count: data.value?.length ?? 0 };
}

export async function searchMail(
  config: OutlookMailConfig,
  params: { query?: string; from?: string; subject?: string; since?: string; before?: string; limit?: number },
): Promise<unknown> {
  const { clientId, clientSecret, refreshToken } = config;
  if (!clientId) return { error: "OUTLOOK_CLIENT_ID not set" };
  const token = await getToken(clientId, clientSecret, refreshToken);
  const limit = params.limit ?? 10;
  const filters: string[] = [];
  if (params.from) filters.push(`from/emailAddress/address eq '${esc(String(params.from))}'`);
  if (params.subject) filters.push(`contains(subject,'${esc(String(params.subject))}')`);
  if (params.since) filters.push(`receivedDateTime ge ${params.since}T00:00:00Z`);
  if (params.before) filters.push(`receivedDateTime le ${params.before}T00:00:00Z`);
  const base = `/me/messages?$top=${limit}&$select=subject,from,receivedDateTime,isRead,bodyPreview&$orderby=receivedDateTime%20desc`;
  const path = filters.length ? `${base}&$filter=${encodeURIComponent(filters.join(" and "))}` : base;
  const data = await graphGet(token, path) as { value: Array<Record<string, unknown>> };
  return { messages: (data.value ?? []).map(m => formatMessage(m, true)), count: data.value?.length ?? 0 };
}

export async function readMessage(
  config: OutlookMailConfig,
  params: { message_id: string },
): Promise<unknown> {
  const { clientId, clientSecret, refreshToken } = config;
  if (!clientId) return { error: "OUTLOOK_CLIENT_ID not set" };
  const token = await getToken(clientId, clientSecret, refreshToken);
  const msgId = params.message_id?.trim();
  if (!msgId) return { error: "message_id is required" };
  const data = await graphGet(token, `/me/messages/${encodeURIComponent(msgId)}`) as Record<string, unknown>;
  const body = (data.body as Record<string, string> | undefined);
  return { ...formatMessage(data), body: body?.content ?? "", content_type: body?.contentType ?? "" };
}

export async function saveAttachments(
  config: OutlookMailConfig,
  params: { message_id: string; output_dir: string; content_types?: string[] },
): Promise<unknown> {
  const { default: fs } = await import("node:fs");
  const { default: path } = await import("node:path");
  const { clientId, clientSecret, refreshToken } = config;
  if (!clientId) return { error: "OUTLOOK_CLIENT_ID not set" };
  const token = await getToken(clientId, clientSecret, refreshToken);
  const msgId = params.message_id?.trim();
  const outputDir = params.output_dir?.trim();
  if (!msgId) return { error: "message_id is required" };
  if (!outputDir) return { error: "output_dir is required" };
  const filters = params.content_types ?? ["image/*"];
  fs.mkdirSync(outputDir, { recursive: true });
  const attData = await graphGet(token, `/me/messages/${encodeURIComponent(msgId)}/attachments`) as { value: Array<Record<string, unknown>> };
  const saved: string[] = [];
  for (const att of attData.value ?? []) {
    const ct = String(att.contentType ?? "");
    const matches = filters.some(f => { if (f.endsWith("/*")) return ct.startsWith(f.slice(0, -1)); return ct === f; });
    if (!matches) continue;
    const name = String(att.name ?? "attachment");
    const safe = path.basename(name).replace(/[/\\]/g, "_") || "attachment";
    const dest = path.join(outputDir, safe);
    const content = String(att.contentBytes ?? "");
    fs.writeFileSync(dest, Buffer.from(content, "base64"));
    saved.push(dest);
  }
  return { saved, count: saved.length };
}
