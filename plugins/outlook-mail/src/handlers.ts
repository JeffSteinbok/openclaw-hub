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

export async function sendMessage(
  config: OutlookMailConfig,
  params: {
    to: string | string[];
    cc?: string[];
    subject: string;
    body: string;
    signature?: string;
    attachment?: string[];
    in_reply_to?: string;
    references?: string;
  },
): Promise<unknown> {
  const { clientId, clientSecret, refreshToken } = config;
  if (!clientId) return { error: "OUTLOOK_CLIENT_ID not set" };
  const token = await getToken(clientId, clientSecret, refreshToken, "Mail.Send Mail.ReadWrite");

  const toList = Array.isArray(params.to) ? params.to : [params.to];
  const ccList = params.cc ?? [];
  const bodyText = params.signature ? `${params.body}\n\n${params.signature}` : params.body;

  // Build message object
  const messageObj: Record<string, unknown> = {
    subject: params.subject,
    body: { contentType: "Text", content: bodyText },
    toRecipients: toList.map(e => ({ emailAddress: { address: e } })),
    ...(ccList.length > 0 ? { ccRecipients: ccList.map(e => ({ emailAddress: { address: e } })) } : {}),
    ...(params.in_reply_to ? { internetMessageHeaders: [{ name: "In-Reply-To", value: params.in_reply_to }] } : {}),
  };

  // Handle attachments
  if (params.attachment && params.attachment.length > 0) {
    const { readFile } = await import("node:fs/promises");
    const { basename } = await import("node:path");
    const attachments: Array<Record<string, unknown>> = [];
    for (const filepath of params.attachment) {
      const data = await readFile(filepath);
      attachments.push({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: basename(filepath),
        contentBytes: data.toString("base64"),
      });
    }
    messageObj.attachments = attachments;
  }

  // Create draft then send
  const createRes = await httpPostJson(
    `${GRAPH_BASE}/me/messages`,
    JSON.stringify(messageObj),
    token,
  );
  const created = JSON.parse(createRes) as Record<string, unknown>;
  if (created.error) return { error: JSON.stringify(created.error) };
  const msgId = String(created.id ?? "");
  if (!msgId) return { error: "Failed to create draft message" };

  // Send it
  await httpPostEmpty(`${GRAPH_BASE}/me/messages/${encodeURIComponent(msgId)}/send`, token);

  const attNote = params.attachment?.length ? ` (${params.attachment.length} attachment(s))` : "";
  return { ok: true, message: `✓ Sent to ${toList.join(", ")}: ${params.subject}${attNote}` };
}

export async function createMeeting(
  config: OutlookMailConfig,
  params: {
    to: string | string[];
    cc?: string[];
    subject: string;
    start: string;
    duration?: string;
    location?: string;
    description?: string;
    timezone?: string;
    signature?: string;
  },
): Promise<unknown> {
  const { clientId, clientSecret, refreshToken } = config;
  if (!clientId) return { error: "OUTLOOK_CLIENT_ID not set" };
  const token = await getToken(clientId, clientSecret, refreshToken, "Calendars.ReadWrite");

  const startDt = new Date(params.start);
  if (isNaN(startDt.getTime())) return { error: `Invalid start: '${params.start}'` };
  const mins = parseDurationMins(params.duration ?? "1h");
  const endDt = new Date(startDt.getTime() + mins * 60_000);
  const tz = params.timezone ?? "America/Los_Angeles";

  const toList = Array.isArray(params.to) ? params.to : [params.to];
  const ccList = params.cc ?? [];
  const allAttendees = [
    ...toList.map(e => ({ emailAddress: { address: e }, type: "required" })),
    ...ccList.map(e => ({ emailAddress: { address: e }, type: "optional" })),
  ];

  const eventObj: Record<string, unknown> = {
    subject: params.subject,
    start: { dateTime: startDt.toISOString(), timeZone: tz },
    end: { dateTime: endDt.toISOString(), timeZone: tz },
    attendees: allAttendees,
    isOnlineMeeting: false,
    ...(params.location ? { location: { displayName: params.location } } : {}),
    ...(params.description ? { body: { contentType: "Text", content: params.description } } : {}),
  };

  const res = await httpPostJson(`${GRAPH_BASE}/me/events`, JSON.stringify(eventObj), token);
  const created = JSON.parse(res) as Record<string, unknown>;
  if (created.error) return { error: JSON.stringify(created.error) };

  return {
    ok: true,
    id: created.id,
    iCalUId: created.iCalUId,
    subject: created.subject,
    start: (created.start as Record<string, string>)?.dateTime,
    end: (created.end as Record<string, string>)?.dateTime,
    webLink: created.webLink,
    message: `✓ Meeting created: ${params.subject} (${startDt.toISOString().slice(0, 16)})`,
  };
}

export async function updateEvent(
  config: OutlookMailConfig,
  params: {
    event_id?: string;
    find?: string;
    new_title?: string;
    new_start?: string;
    new_duration?: string;
    new_location?: string;
    new_description?: string;
    timezone?: string;
    status?: string;
    add_attendee?: string[];
    remove_attendee?: string[];
    force?: boolean;
  },
): Promise<unknown> {
  const { clientId, clientSecret, refreshToken } = config;
  if (!clientId) return { error: "OUTLOOK_CLIENT_ID not set" };
  const token = await getToken(clientId, clientSecret, refreshToken, "Calendars.ReadWrite");

  if (!params.event_id && !params.find) return { error: "Provide event_id or find to identify the event." };

  let eventId: string;
  let currentEvent: Record<string, unknown>;

  if (params.event_id) {
    eventId = params.event_id;
    const res = await graphGet(token, `/me/events/${encodeURIComponent(eventId)}`);
    currentEvent = res as Record<string, unknown>;
    if (currentEvent.error) return { error: JSON.stringify(currentEvent.error) };
  } else {
    // Search by title
    const needle = esc(String(params.find));
    const res = await graphGet(token, `/me/events?$filter=contains(subject,'${needle}')&$top=10&$select=id,subject,start,end,attendees`) as { value: Array<Record<string, unknown>> };
    const matches = res.value ?? [];
    if (matches.length === 0) return { error: `No event found matching: '${params.find}'` };
    if (matches.length > 1 && !params.force) {
      return {
        error: `Found ${matches.length} matching events. Use event_id to target one, or force=true to update all.`,
        events: matches.map(e => ({ id: e.id, subject: e.subject, start: (e.start as Record<string, string>)?.dateTime })),
      };
    }
    // Update the first (or all if force)
    const targets = params.force ? matches : [matches[0]];
    const results: unknown[] = [];
    for (const ev of targets) {
      const r = await updateEvent(config, { ...params, event_id: String(ev.id), find: undefined });
      results.push(r);
    }
    return { updated: results.length, results };
  }

  const tz = params.timezone ?? "America/Los_Angeles";
  const patch: Record<string, unknown> = {};

  if (params.new_title) patch.subject = params.new_title;
  if (params.new_description) patch.body = { contentType: "Text", content: params.new_description };
  if (params.new_location) patch.location = { displayName: params.new_location };
  if (params.status) patch.showAs = params.status;

  if (params.new_start) {
    const newStart = new Date(params.new_start);
    if (isNaN(newStart.getTime())) return { error: `Invalid new_start: '${params.new_start}'` };
    patch.start = { dateTime: newStart.toISOString(), timeZone: tz };
    if (params.new_duration) {
      const mins = parseDurationMins(params.new_duration);
      patch.end = { dateTime: new Date(newStart.getTime() + mins * 60_000).toISOString(), timeZone: tz };
    }
  } else if (params.new_duration) {
    const existingStart = (currentEvent.start as Record<string, string>)?.dateTime;
    if (existingStart) {
      const base = new Date(existingStart);
      const mins = parseDurationMins(params.new_duration);
      patch.end = { dateTime: new Date(base.getTime() + mins * 60_000).toISOString(), timeZone: tz };
    }
  }

  // Attendee changes — read current list, merge
  if (params.add_attendee?.length || params.remove_attendee?.length) {
    const existing = (currentEvent.attendees as Array<Record<string, unknown>> | undefined) ?? [];
    let attendees = existing.map(a => ({ ...(a as object) })) as Array<Record<string, unknown>>;
    if (params.remove_attendee) {
      const toRemove = new Set(params.remove_attendee.map(e => e.toLowerCase()));
      attendees = attendees.filter(a => {
        const email = String(((a.emailAddress as Record<string, string> | undefined)?.address) ?? "").toLowerCase();
        return !toRemove.has(email);
      });
    }
    if (params.add_attendee) {
      for (const email of params.add_attendee) {
        attendees.push({ emailAddress: { address: email }, type: "required" });
      }
    }
    patch.attendees = attendees;
  }

  if (Object.keys(patch).length === 0) return { error: "No changes specified." };

  const res = await httpPatch(`${GRAPH_BASE}/me/events/${encodeURIComponent(eventId)}`, JSON.stringify(patch), token);
  const updated = JSON.parse(res) as Record<string, unknown>;
  if (updated.error) return { error: JSON.stringify(updated.error) };

  return { ok: true, id: eventId, message: `✓ Event updated: ${updated.subject ?? eventId}` };
}

export async function queryEvents(
  config: OutlookMailConfig,
  params: {
    after?: string;
    before?: string;
    text?: string;
    attendee?: string;
    uid?: string;
  },
): Promise<unknown> {
  const { clientId, clientSecret, refreshToken } = config;
  if (!clientId) return { error: "OUTLOOK_CLIENT_ID not set" };
  const token = await getToken(clientId, clientSecret, refreshToken, "Calendars.Read");

  if (params.uid) {
    // iCalUId lookup
    const res = await graphGet(token, `/me/events?$filter=iCalUId eq '${esc(params.uid)}'`) as { value: Array<Record<string, unknown>> };
    return { events: (res.value ?? []).map(formatEvent) };
  }

  const filters: string[] = [];
  if (params.after) filters.push(`start/dateTime ge '${params.after}T00:00:00'`);
  if (params.before) filters.push(`end/dateTime le '${params.before}T23:59:59'`);
  if (params.text) filters.push(`contains(subject,'${esc(params.text)}')`);

  const qs = filters.length
    ? `?$filter=${encodeURIComponent(filters.join(" and "))}&$top=50&$orderby=start/dateTime`
    : `?$top=20&$orderby=start/dateTime`;

  const res = await graphGet(token, `/me/events${qs}`) as { value: Array<Record<string, unknown>> };
  let events = (res.value ?? []).map(formatEvent);

  // Client-side attendee filter (Graph can't filter on attendee email easily)
  if (params.attendee) {
    const att = params.attendee.toLowerCase();
    events = events.filter(e =>
      (e.attendees as Array<Record<string, string>>)?.some(
        (a: Record<string, string>) => a.email?.toLowerCase() === att,
      ),
    );
  }

  return { count: events.length, events };
}

// ---------------------------------------------------------------------------
// Additional HTTP helpers
// ---------------------------------------------------------------------------

function httpPostJson(url: string, body: string, token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 30_000,
    }, res => {
      let data = ""; res.on("data", (c: Buffer) => data += c); res.on("end", () => resolve(data));
    });
    req.on("error", reject); req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); }); req.write(body); req.end();
  });
}

function httpPostEmpty(url: string, token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Length": 0 },
      timeout: 30_000,
    }, res => {
      res.resume(); res.on("end", () => {
        if ((res.statusCode ?? 0) >= 400) reject(new Error(`Send failed: HTTP ${res.statusCode}`));
        else resolve();
      });
    });
    req.on("error", reject); req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); }); req.end();
  });
}

function httpPatch(url: string, body: string, token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 30_000,
    }, res => {
      let data = ""; res.on("data", (c: Buffer) => data += c); res.on("end", () => resolve(data));
    });
    req.on("error", reject); req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); }); req.write(body); req.end();
  });
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function parseDurationMins(d: string): number {
  const s = d.toLowerCase().trim();
  if (s.endsWith("h")) return Math.round(parseFloat(s.slice(0, -1)) * 60);
  if (s.endsWith("m")) return parseInt(s.slice(0, -1), 10);
  const n = parseInt(s, 10);
  if (isNaN(n)) throw new Error(`Invalid duration: '${d}' (use e.g. '1h', '30m', '1.5h')`);
  return n;
}

function formatEvent(e: Record<string, unknown>): Record<string, unknown> {
  const start = (e.start as Record<string, string> | undefined)?.dateTime ?? "";
  const end = (e.end as Record<string, string> | undefined)?.dateTime ?? "";
  const attendees = ((e.attendees as Array<Record<string, unknown>>) ?? []).map(a => ({
    email: String(((a.emailAddress as Record<string, string> | undefined)?.address) ?? ""),
    name: String(((a.emailAddress as Record<string, string> | undefined)?.name) ?? ""),
    type: String(a.type ?? ""),
    status: String(((a.status as Record<string, string> | undefined)?.response) ?? ""),
  }));
  return {
    id: e.id,
    iCalUId: e.iCalUId,
    subject: e.subject,
    start: start.slice(0, 16),
    end: end.slice(0, 16),
    location: (e.location as Record<string, string> | undefined)?.displayName ?? "",
    organizer: ((e.organizer as Record<string, Record<string, string>> | undefined)?.emailAddress?.address) ?? "",
    attendees,
    webLink: e.webLink,
  };
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
