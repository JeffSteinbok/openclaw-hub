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
