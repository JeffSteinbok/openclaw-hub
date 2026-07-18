/**
 * Outlook Calendar — core handlers.
 *
 * Pure logic with no knowledge of how it's invoked (plugin vs CLI).
 * Config is passed in; handlers never read env vars or plugin APIs directly.
 */

import https from "node:https";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OutlookCalendarConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  personalCalendarNames: string[];
  familyCalendarNames: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const CALENDAR_DEFAULTS: Record<string, string[]> = {
  personal: ["calendar", "personal"],
  family: ["family v2", "your family", "family"],
};

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

function httpRequest(
  method: "PATCH" | "DELETE",
  url: string,
  token: string,
  body?: string,
): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
    if (body) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(body));
    }
    const req = https.request(url, { method, headers, timeout: 30_000 }, res => {
      let data = ""; res.on("data", (c: Buffer) => data += c); res.on("end", () => resolve({ status: res.statusCode ?? 0, data }));
    });
    req.on("error", reject); req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    if (body) req.write(body);
    req.end();
  });
}

function httpPostJson(
  url: string,
  token: string,
  body: string,
): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body)),
    };
    const req = https.request(url, { method: "POST", headers, timeout: 30_000 }, res => {
      let data = ""; res.on("data", (c: Buffer) => data += c); res.on("end", () => resolve({ status: res.statusCode ?? 0, data }));
    });
    req.on("error", reject); req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Token / Graph
// ---------------------------------------------------------------------------

async function getAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: "Calendars.ReadWrite",
  }).toString();
  const res = await httpPost(TOKEN_URL, body, { "Content-Type": "application/x-www-form-urlencoded" });
  const parsed = JSON.parse(res);
  if (parsed.error) throw new Error(`Token error: ${parsed.error_description ?? parsed.error}`);
  return parsed.access_token;
}

async function graphGet(token: string, path: string): Promise<unknown> {
  const res = await httpGet(`${GRAPH_BASE}${path}`, token);
  return JSON.parse(res);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function utcToLocal(s: string): string {
  try {
    const dt = new Date(s.slice(0, 19) + "Z");
    return dt.toLocaleString("en-US", { year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", hour12: true });
  } catch { return s.slice(0, 16); }
}

function formatEvent(e: Record<string, unknown>): Record<string, unknown> {
  const start = (e.start as Record<string, string>); const end = (e.end as Record<string, string>);
  const tz = start?.timeZone ?? "UTC";
  const fmtTime = (s: string) => tz === "UTC" ? utcToLocal(s) : s.slice(0, 16);
  const attendees = ((e.attendees ?? []) as Array<Record<string, unknown>>).map(a => {
    const ea = (a.emailAddress ?? {}) as Record<string, string>;
    return { name: ea.name ?? "", email: ea.address ?? "", status: ((a.status as Record<string, string>)?.response ?? "none"), type: String(a.type ?? "required") };
  });
  const result: Record<string, unknown> = {
    id: String(e.id ?? ""),
    subject: String(e.subject ?? "No subject"), start: fmtTime(start?.dateTime ?? ""), end: fmtTime(end?.dateTime ?? ""),
    location: ((e.location as Record<string, string>)?.displayName || "No location"),
    organizer: ((e.organizer as Record<string, Record<string, string>>)?.emailAddress?.name || ((e.organizer as Record<string, Record<string, string>>)?.emailAddress?.address ?? "")),
    my_status: ((e.responseStatus as Record<string, string>)?.response ?? "none"), show_as: String(e.showAs ?? "busy"),
  };
  if (attendees.length) result.attendees = attendees;
  const bodyContent = (e.body as Record<string, string> | undefined)?.content;
  if (bodyContent && bodyContent.trim()) {
    const plainText = bodyContent.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
    if (plainText.length > 0) result.body = plainText;
  }
  return result;
}

function calendarSearchNames(config: OutlookCalendarConfig, key: string): string[] {
  const extraNames = key === "personal" ? config.personalCalendarNames : config.familyCalendarNames;
  return [...extraNames, ...CALENDAR_DEFAULTS[key]];
}


// ---------------------------------------------------------------------------
// Unified config (superset of mail + calendar configs)
// ---------------------------------------------------------------------------

export type OutlookConfig = OutlookCalendarConfig;
export type OutlookMailConfig = OutlookConfig;
/** Resolve ISO datetime + optional timezone into a Graph dateTimeTimeZone object. */
function toGraphDateTime(isoStr: string, timezone: string): { dateTime: string; timeZone: string } {
  // Strip any trailing Z or offset — Graph wants wall-clock in the given tz
  const dt = isoStr.replace(/Z$/, "").replace(/[+-]\d{2}:\d{2}$/, "");
  return { dateTime: dt.length === 16 ? `${dt}:00` : dt, timeZone: timezone };
}

/** Parse duration string like "1h", "30m", "1.5h", "2h30m" into minutes. */
function parseDurationMinutes(s: string): number {
  const hours = s.match(/(\d+(?:\.\d+)?)\s*h/i);
  const mins = s.match(/(\d+(?:\.\d+)?)\s*m(?!o)/i); // avoid matching 'month'
  let total = 0;
  if (hours) total += parseFloat(hours[1]) * 60;
  if (mins) total += parseFloat(mins[1]);
  if (!hours && !mins) {
    const num = parseFloat(s);
    if (!isNaN(num)) total = num; // bare number treated as minutes
  }
  return Math.round(total);
}

/** Add minutes to an ISO datetime string (wall-clock, no tz offset). */
function addMinutes(isoStr: string, minutes: number): string {
  const clean = isoStr.replace(/Z$/, "").replace(/[+-]\d{2}:\d{2}$/, "");
  const d = new Date(clean + "Z");
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d.toISOString().slice(0, 19);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function fetchCalendar(
  config: OutlookCalendarConfig,
  params: { calendar?: string; days?: number },
): Promise<unknown> {
  const { clientId, clientSecret, refreshToken } = config;
  if (!clientId || !clientSecret || !refreshToken) {
    return { error: "OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, OUTLOOK_REFRESH_TOKEN must be set" };
  }
  const calendar = params.calendar ?? "all";
  const days = params.days ?? 7;
  const token = await getAccessToken(clientId, clientSecret, refreshToken);
  const calData = await graphGet(token, "/me/calendars?$select=id,name&$top=50") as { value: Array<{ name: string; id: string }> };
  const calMap: Record<string, string> = {};
  for (const c of calData.value ?? []) calMap[c.name.toLowerCase()] = c.id;
  const start = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const keys = calendar === "all" ? ["personal", "family"] : [calendar];
  const results: Record<string, unknown> = {};
  for (const key of keys) {
    const searchNames = calendarSearchNames(config, key);
    const calId = searchNames.map(n => calMap[n]).find(Boolean);
    if (!calId) { results[key] = { label: key, error: `Calendar not found. Available: ${Object.keys(calMap).join(", ")}`, events: [] }; continue; }
    const qp = new URLSearchParams({ "$select": "id,subject,start,end,location,organizer,attendees,responseStatus,showAs,body", "$orderby": "start/dateTime", "$top": "100", "startDateTime": `${start}T00:00:00`, "endDateTime": `${end}T00:00:00` }).toString();
    const evData = await graphGet(token, `/me/calendars/${calId}/calendarView?${qp}`) as { value: Array<Record<string, unknown>> };
    const events = (evData.value ?? []).map(formatEvent);
    results[key] = { label: key === "personal" ? "Personal" : "Family", count: events.length, start_date: start, end_date: end, events };
  }
  return results;
}

export interface CreateEventParams {
  subject: string;
  start: string;
  duration?: string;
  end?: string;
  timezone?: string;
  location?: string;
  description?: string;
  attendees?: string[];
  calendar?: string;
}

export async function createEvent(
  config: OutlookCalendarConfig,
  params: CreateEventParams,
): Promise<unknown> {
  const { clientId, clientSecret, refreshToken } = config;
  if (!clientId || !clientSecret || !refreshToken) {
    return { error: "OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, OUTLOOK_REFRESH_TOKEN must be set" };
  }
  if (!params.subject) return { error: "subject is required" };
  if (!params.start) return { error: "start is required" };

  const timezone = params.timezone ?? "America/Los_Angeles";
  const token = await getAccessToken(clientId, clientSecret, refreshToken);

  // Resolve end time
  let endIso: string;
  if (params.end) {
    endIso = params.end;
  } else {
    const durationMins = parseDurationMinutes(params.duration ?? "1h");
    endIso = addMinutes(params.start, durationMins);
  }

  // Resolve calendar ID
  let calId: string | undefined;
  const calKey = params.calendar ?? "personal";
  const calData = await graphGet(token, "/me/calendars?$select=id,name&$top=50") as { value: Array<{ name: string; id: string }> };
  const calMap: Record<string, string> = {};
  for (const c of calData.value ?? []) calMap[c.name.toLowerCase()] = c.id;
  const searchNames = calendarSearchNames(config, calKey);
  calId = searchNames.map(n => calMap[n]).find(Boolean);
  if (!calId) return { error: `Calendar '${calKey}' not found. Available: ${Object.keys(calMap).join(", ")}` };

  const body: Record<string, unknown> = {
    subject: params.subject,
    start: toGraphDateTime(params.start, timezone),
    end: toGraphDateTime(endIso, timezone),
  };
  if (params.location) body.location = { displayName: params.location };
  if (params.description) body.body = { contentType: "text", content: params.description };
  if (params.attendees?.length) {
    body.attendees = params.attendees.map(email => ({
      emailAddress: { address: email },
      type: "required",
    }));
  }

  const res = await httpPostJson(`${GRAPH_BASE}/me/calendars/${calId}/events`, token, JSON.stringify(body));
  if (res.status < 200 || res.status >= 300) {
    const err = JSON.parse(res.data ?? "{}");
    return { error: `Graph API error ${res.status}: ${err?.error?.message ?? res.data}` };
  }
  const created = JSON.parse(res.data) as Record<string, unknown>;
  return {
    success: true,
    event_id: String(created.id ?? ""),
    subject: String(created.subject ?? ""),
    start: (created.start as Record<string, string>)?.dateTime ?? "",
    end: (created.end as Record<string, string>)?.dateTime ?? "",
    timezone,
    calendar: calKey,
    web_link: String(created.webLink ?? ""),
  };
}

export interface UpdateEventParams {
  event_id: string;
  subject?: string;
  start?: string;
  end?: string;
  duration?: string;
  timezone?: string;
  location?: string;
  description?: string;
  add_attendees?: string[];
  remove_attendees?: string[];
  status?: "confirmed" | "tentative" | "cancelled";
}

export async function updateEvent(
  config: OutlookCalendarConfig,
  params: UpdateEventParams,
): Promise<unknown> {
  const { clientId, clientSecret, refreshToken } = config;
  if (!clientId || !clientSecret || !refreshToken) {
    return { error: "OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, OUTLOOK_REFRESH_TOKEN must be set" };
  }
  if (!params.event_id) return { error: "event_id is required" };

  const token = await getAccessToken(clientId, clientSecret, refreshToken);
  const patch: Record<string, unknown> = {};

  const timezone = params.timezone ?? "America/Los_Angeles";

  if (params.subject) patch.subject = params.subject;
  if (params.location !== undefined) patch.location = { displayName: params.location };
  if (params.description !== undefined) patch.body = { contentType: "text", content: params.description };

  if (params.status) {
    const showAs: Record<string, string> = { confirmed: "busy", tentative: "tentative", cancelled: "free" };
    patch.showAs = showAs[params.status] ?? "busy";
    if (params.status === "cancelled") patch.isCancelled = true;
  }

  if (params.start) {
    patch.start = toGraphDateTime(params.start, timezone);
    if (params.end) {
      patch.end = toGraphDateTime(params.end, timezone);
    } else if (params.duration) {
      patch.end = toGraphDateTime(addMinutes(params.start, parseDurationMinutes(params.duration)), timezone);
    }
  } else if (params.end) {
    patch.end = toGraphDateTime(params.end, timezone);
  }

  // Attendee merge: fetch current, diff, patch full list
  if (params.add_attendees?.length || params.remove_attendees?.length) {
    const evData = await graphGet(token, `/me/events/${params.event_id}?$select=attendees`) as Record<string, unknown>;
    const current = ((evData.attendees ?? []) as Array<Record<string, unknown>>).map(a => {
      const ea = (a.emailAddress as Record<string, string> | undefined) ?? {};
      return { email: (ea.address ?? "").toLowerCase(), type: String(a.type ?? "required") };
    });
    const removeSet = new Set((params.remove_attendees ?? []).map(e => e.toLowerCase()));
    const kept = current.filter(a => !removeSet.has(a.email));
    const keptEmails = new Set(kept.map(a => a.email));
    const added = (params.add_attendees ?? [])
      .filter(e => !keptEmails.has(e.toLowerCase()))
      .map(e => ({ email: e.toLowerCase(), type: "required" }));
    patch.attendees = [...kept, ...added].map(a => ({
      emailAddress: { address: a.email },
      type: a.type,
    }));
  }

  if (Object.keys(patch).length === 0) {
    return { error: "No fields to update were provided" };
  }

  const res = await httpRequest("PATCH", `${GRAPH_BASE}/me/events/${params.event_id}`, token, JSON.stringify(patch));
  if (res.status < 200 || res.status >= 300) {
    const err = JSON.parse(res.data ?? "{}");
    return { error: `Graph API error ${res.status}: ${err?.error?.message ?? res.data}` };
  }
  const updated = JSON.parse(res.data) as Record<string, unknown>;
  return {
    success: true,
    event_id: String(updated.id ?? params.event_id),
    subject: String(updated.subject ?? ""),
    start: (updated.start as Record<string, string>)?.dateTime ?? "",
    end: (updated.end as Record<string, string>)?.dateTime ?? "",
  };
}

export interface DeleteEventParams {
  event_id: string;
}

export async function deleteEvent(
  config: OutlookCalendarConfig,
  params: DeleteEventParams,
): Promise<unknown> {
  const { clientId, clientSecret, refreshToken } = config;
  if (!clientId || !clientSecret || !refreshToken) {
    return { error: "OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, OUTLOOK_REFRESH_TOKEN must be set" };
  }
  if (!params.event_id) return { error: "event_id is required" };

  const token = await getAccessToken(clientId, clientSecret, refreshToken);
  const res = await httpRequest("DELETE", `${GRAPH_BASE}/me/events/${params.event_id}`, token);
  if (res.status === 204) return { success: true, event_id: params.event_id };
  if (res.status < 200 || res.status >= 300) {
    const err = (() => { try { return JSON.parse(res.data ?? "{}"); } catch { return {}; } })();
    return { error: `Graph API error ${res.status}: ${err?.error?.message ?? res.data}` };
  }
  return { success: true, event_id: params.event_id };
}

// ---------------------------------------------------------------------------
// createMeeting — send invite to attendees
// ---------------------------------------------------------------------------

export interface CreateMeetingParams {
  to: string | string[];
  cc?: string[];
  subject: string;
  start: string;
  duration?: string;
  end?: string;
  location?: string;
  description?: string;
  timezone?: string;
  signature?: string;
}

export async function createMeeting(
  config: OutlookCalendarConfig,
  params: CreateMeetingParams,
): Promise<unknown> {
  const { clientId, clientSecret, refreshToken } = config;
  if (!clientId || !clientSecret || !refreshToken) {
    return { error: "OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, OUTLOOK_REFRESH_TOKEN must be set" };
  }
  const token = await getAccessToken(clientId, clientSecret, refreshToken);
  const tz = params.timezone ?? "America/Los_Angeles";
  const start = toGraphDateTime(params.start, tz);
  const endDt = params.end
    ? toGraphDateTime(params.end, tz)
    : { dateTime: addMinutes(params.start, parseDurationMinutes(params.duration ?? "1h")), timeZone: tz };

  const toList = Array.isArray(params.to) ? params.to : [params.to];
  const ccList = params.cc ?? [];
  const attendees = [
    ...toList.map(e => ({ emailAddress: { address: e }, type: "required" })),
    ...ccList.map(e => ({ emailAddress: { address: e }, type: "optional" })),
  ];

  const body: Record<string, unknown> = {
    subject: params.subject,
    start,
    end: endDt,
    attendees,
    ...(params.location ? { location: { displayName: params.location } } : {}),
    ...(params.description ? { body: { contentType: "Text", content: params.description } } : {}),
  };

  const res = await httpPostJson(`${GRAPH_BASE}/me/events`, JSON.stringify(body), token);
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
    message: `✓ Meeting created: ${params.subject}`,
  };
}

// ---------------------------------------------------------------------------
// queryEvents — filter events by date range / text / attendee / UID
// ---------------------------------------------------------------------------

export interface QueryEventsParams {
  after?: string;
  before?: string;
  text?: string;
  attendee?: string;
  uid?: string;
}

export async function queryEvents(
  config: OutlookCalendarConfig,
  params: QueryEventsParams,
): Promise<unknown> {
  const { clientId, clientSecret, refreshToken } = config;
  if (!clientId || !clientSecret || !refreshToken) {
    return { error: "OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, OUTLOOK_REFRESH_TOKEN must be set" };
  }
  const token = await getAccessToken(clientId, clientSecret, refreshToken);

  const esc = (s: string) => s.replace(/'/g, "''");

  if (params.uid) {
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

// ---------------------------------------------------------------------------
// Send / Reply / Forward / Move / Flag handlers
// ---------------------------------------------------------------------------

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
  if (!params.subject?.trim()) return { error: "subject is required" };
  if (!params.body?.trim()) return { error: "body is required" };

  const token = await getToken(clientId, clientSecret, refreshToken);
  const toList = Array.isArray(params.to) ? params.to : [params.to];
  if (!toList.length) return { error: "to is required" };

  const bodyText = params.signature ? `${params.body}\n\n${params.signature}` : params.body;
  const message: Record<string, unknown> = {
    subject: params.subject,
    body: { contentType: "Text", content: bodyText },
    toRecipients: toList.map(e => ({ emailAddress: { address: e.trim() } })),
  };
  if (params.cc?.length) {
    message.ccRecipients = params.cc.map(e => ({ emailAddress: { address: e.trim() } }));
  }
  if (params.in_reply_to) {
    message.internetMessageHeaders = [{ name: "In-Reply-To", value: params.in_reply_to }];
  }

  if (params.attachment?.length) {
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
    message.attachments = attachments;
  }

  // Create draft message then send it
  const createRes = await graphPost(token, "/me/messages", message) as Record<string, unknown>;
  if (createRes.error) return { error: JSON.stringify(createRes.error) };
  const msgId = String(createRes.id ?? "");
  if (!msgId) return { error: "Failed to create draft message" };

  await httpPostEmpty(`${GRAPH_BASE}/me/messages/${encodeURIComponent(msgId)}/send`, token);

  const attNote = params.attachment?.length ? ` (${params.attachment.length} attachment(s))` : "";
  return { ok: true, message: `✓ Sent to ${toList.join(", ")}: ${params.subject}${attNote}` };
}

export async function replyToMessage(
  config: OutlookMailConfig,
  params: {
    message_id: string;
    body: string;
    reply_all?: boolean;
    signature?: string;
  },
): Promise<unknown> {
  const { clientId, clientSecret, refreshToken } = config;
  if (!clientId) return { error: "OUTLOOK_CLIENT_ID not set" };
  const msgId = params.message_id?.trim();
  if (!msgId) return { error: "message_id is required" };
  if (!params.body?.trim()) return { error: "body is required" };

  const token = await getToken(clientId, clientSecret, refreshToken);
  const bodyText = params.signature ? `${params.body}\n\n${params.signature}` : params.body;
  const endpoint = params.reply_all
    ? `/me/messages/${encodeURIComponent(msgId)}/replyAll`
    : `/me/messages/${encodeURIComponent(msgId)}/reply`;

  const payload = {
    message: { body: { contentType: "Text", content: bodyText } },
    comment: bodyText,
  };
  const res = await graphPost(token, endpoint, payload) as Record<string, unknown>;
  if (res.error) return { error: JSON.stringify(res.error) };
  return { ok: true, message: `✓ Reply sent${params.reply_all ? " (reply-all)" : ""}` };
}

export async function forwardMessage(
  config: OutlookMailConfig,
  params: {
    message_id: string;
    to: string | string[];
    comment?: string;
  },
): Promise<unknown> {
  const { clientId, clientSecret, refreshToken } = config;
  if (!clientId) return { error: "OUTLOOK_CLIENT_ID not set" };
  const msgId = params.message_id?.trim();
  if (!msgId) return { error: "message_id is required" };
  const toList = Array.isArray(params.to) ? params.to : [params.to];
  if (!toList.length) return { error: "to is required" };

  const token = await getToken(clientId, clientSecret, refreshToken);
  const payload: Record<string, unknown> = {
    toRecipients: toList.map(e => ({ emailAddress: { address: e.trim() } })),
  };
  if (params.comment) payload.comment = params.comment;

  const res = await graphPost(token, `/me/messages/${encodeURIComponent(msgId)}/forward`, payload) as Record<string, unknown>;
  if (res.error) return { error: JSON.stringify(res.error) };
  return { ok: true, message: `✓ Forwarded to ${toList.join(", ")}` };
}

export async function moveMessage(
  config: OutlookMailConfig,
  params: { message_id: string; destination_folder: string },
): Promise<unknown> {
  const { clientId, clientSecret, refreshToken } = config;
  if (!clientId) return { error: "OUTLOOK_CLIENT_ID not set" };
  const msgId = params.message_id?.trim();
  if (!msgId) return { error: "message_id is required" };
  if (!params.destination_folder?.trim()) return { error: "destination_folder is required" };

  const token = await getToken(clientId, clientSecret, refreshToken);
  const res = await graphPost(token, `/me/messages/${encodeURIComponent(msgId)}/move`, { destinationId: params.destination_folder }) as Record<string, unknown>;
  if (res.error) return { error: JSON.stringify(res.error) };
  return { ok: true, new_id: res.id ?? null };
}

export async function flagMessage(
  config: OutlookMailConfig,
  params: { message_id: string; flag_status: "flagged" | "complete" | "notFlagged" },
): Promise<unknown> {
  const { clientId, clientSecret, refreshToken } = config;
  if (!clientId) return { error: "OUTLOOK_CLIENT_ID not set" };
  const msgId = params.message_id?.trim();
  if (!msgId) return { error: "message_id is required" };

  const token = await getToken(clientId, clientSecret, refreshToken);
  const res = await graphPatch(token, `/me/messages/${encodeURIComponent(msgId)}`, { flag: { flagStatus: params.flag_status } }) as Record<string, unknown>;
  if (res.error) return { error: JSON.stringify(res.error) };
  return { ok: true, flag_status: params.flag_status };
}
