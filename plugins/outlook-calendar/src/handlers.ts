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

// ---------------------------------------------------------------------------
// Token / Graph
// ---------------------------------------------------------------------------

async function getAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token", scope: "Calendars.Read" }).toString();
  const res = await httpPost(TOKEN_URL, body, { "Content-Type": "application/x-www-form-urlencoded" });
  return JSON.parse(res).access_token;
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
    subject: String(e.subject ?? "No subject"), start: fmtTime(start?.dateTime ?? ""), end: fmtTime(end?.dateTime ?? ""),
    location: ((e.location as Record<string, string>)?.displayName || "No location"),
    organizer: ((e.organizer as Record<string, Record<string, string>>)?.emailAddress?.name || ((e.organizer as Record<string, Record<string, string>>)?.emailAddress?.address ?? "")),
    my_status: ((e.responseStatus as Record<string, string>)?.response ?? "none"), show_as: String(e.showAs ?? "busy"),
  };
  if (attendees.length) result.attendees = attendees;
  return result;
}

function calendarSearchNames(config: OutlookCalendarConfig, key: string): string[] {
  const extraNames = key === "personal" ? config.personalCalendarNames : config.familyCalendarNames;
  return [...extraNames, ...CALENDAR_DEFAULTS[key]];
}

// ---------------------------------------------------------------------------
// Handler
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
    const qp = new URLSearchParams({ "$select": "subject,start,end,location,organizer,attendees,responseStatus,showAs", "$orderby": "start/dateTime", "$top": "100", "startDateTime": `${start}T00:00:00`, "endDateTime": `${end}T00:00:00` }).toString();
    const evData = await graphGet(token, `/me/calendars/${calId}/calendarView?${qp}`) as { value: Array<Record<string, unknown>> };
    const events = (evData.value ?? []).map(formatEvent);
    results[key] = { label: key === "personal" ? "Personal" : "Family", count: events.length, start_date: start, end_date: end, events };
  }
  return results;
}
