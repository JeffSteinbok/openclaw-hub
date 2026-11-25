/**
 * Outlook Work Calendar — core handlers.
 *
 * Pure logic with no knowledge of how it's invoked (plugin vs CLI).
 * Config is passed in; handlers never read env vars or plugin APIs directly.
 */

import https from "node:https";
import http from "node:http";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OutlookWorkCalendarConfig {
  calendarUrl: string;
  folderId: string;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpPost(url: string, body: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.request(url, { method: "POST", headers, timeout: 30_000 }, res => {
      let data = ""; res.on("data", (c: Buffer) => data += c); res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", reject); req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); }); req.write(body); req.end();
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRequestBody(folderId: string, startDate: string, endDate: string): unknown {
  // Append local midnight time directly without parsing through Date (which treats YYYY-MM-DD as UTC).
  // The EWS endpoint uses the TimeZoneContext to interpret these datetime strings as local time.
  const fmtDt = (d: string) => `${d}T00:00:00.000`;
  return {
    "__type": "FindItemJsonRequest:#Exchange",
    Header: { "__type": "JsonRequestHeaders:#Exchange", RequestServerVersion: "Exchange2013",
      TimeZoneContext: { "__type": "TimeZoneContext:#Exchange", TimeZoneDefinition: { "__type": "TimeZoneDefinitionType:#Exchange", Id: "Pacific Standard Time" } } },
    Body: { "__type": "FindItemRequest:#Exchange",
      ParentFolderIds: [{ "__type": "FolderId:#Exchange", Id: folderId }],
      ItemShape: { "__type": "ItemResponseShape:#Exchange", BaseShape: "IdOnly" },
      Traversal: "Shallow",
      Paging: { "__type": "CalendarPageView:#Exchange", StartDate: fmtDt(startDate), EndDate: fmtDt(endDate) } },
  };
}

interface FindItemResponse {
  Body?: {
    ResponseMessages?: {
      Items?: Array<{
        ResponseClass?: string;
        ResponseCode?: string;
        RootFolder?: { Items?: Array<Record<string, unknown>> };
      }>;
    };
  };
}

function formatEvent(e: Record<string, unknown>): Record<string, unknown> {
  const subject = String(e.Subject ?? "No subject");
  const sensitivity = String(e.Sensitivity ?? "Normal");
  const isAllDay = Boolean(e.IsAllDayEvent);
  const title = subject + (sensitivity === "Private" ? " [PRIVATE]" : "") + (isAllDay ? " [ALL DAY]" : "");
  return {
    subject: title, start: String(e.Start ?? ""), end: String(e.End ?? ""),
    location: (e.Location as Record<string, string> | undefined)?.DisplayName || "No location",
    busy_type: String(e.FreeBusyType ?? "busy"), is_all_day: isAllDay,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** Shift a YYYY-MM-DD date string by N days without timezone drift. */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export const WORK_CALENDAR_DAYS = 28;

export async function fetchWorkCalendar(
  config: OutlookWorkCalendarConfig,
  params: { days?: number; after?: string; before?: string },
): Promise<unknown> {
  const { calendarUrl, folderId } = config;
  if (!calendarUrl) return { error: "OUTLOOK_WORK_CALENDAR_URL is not set" };
  if (!folderId) return { error: "OUTLOOK_WORK_FOLDER_ID is not set" };
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const lastAvailable = addDays(today, WORK_CALENDAR_DAYS - 1);
  const days = params.days ?? 7;
  const startDate = params.after ?? today;
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && addDays(value, 0) === value;
  if (!validDate(startDate) || (params.before !== undefined && !validDate(params.before))) {
    return { error: "Use YYYY-MM-DD for after and before." };
  }
  if (params.before === undefined && (!Number.isInteger(days) || days < 1)) {
    return { error: "days must be a positive integer." };
  }
  const rollingWindow = params.after === undefined && params.before === undefined;
  if (startDate > lastAvailable || (rollingWindow && days > WORK_CALENDAR_DAYS) ||
      (params.before !== undefined && params.before > lastAvailable)) {
    return { error: `Future work calendar coverage is limited to ${WORK_CALENDAR_DAYS} days including today (through ${lastAvailable}, Pacific time).` };
  }
  const requestedEnd = params.before ?? addDays(startDate, rollingWindow ? days - 1 : Math.min(days, WORK_CALENDAR_DAYS));
  const lastDay = requestedEnd > lastAvailable ? lastAvailable : requestedEnd;
  const endDate = addDays(lastDay, 1);
  if (endDate <= startDate) return { error: "before must be on or after after." };
  const url = `${calendarUrl}/service.svc?action=FindItem&app=PublishedCalendar&n=18`;
  const body = JSON.stringify(buildRequestBody(folderId, startDate, endDate));
  const res = await httpPost(url, body, { "Content-Type": "application/json; charset=utf-8", "Action": "FindItem", "User-Agent": "Mozilla/5.0" });
  if (res.status < 200 || res.status >= 300) {
    return { error: `Published work calendar request failed (HTTP ${res.status}).` };
  }
  if (!res.body.trim()) return { error: "Published work calendar returned an empty response." };
  let data: FindItemResponse | null;
  try {
    data = JSON.parse(res.body);
  } catch {
    return { error: "Published work calendar returned an invalid JSON response." };
  }
  const message = data?.Body?.ResponseMessages?.Items?.[0];
  if (message?.ResponseClass === "Error") {
    const code = message.ResponseCode;
    const detail = typeof code === "string" && /^Error[A-Za-z]{1,80}$/.test(code) ? ` (${code})` : "";
    return { error: `Published work calendar request failed in Exchange${detail}.` };
  }
  if (!message?.RootFolder) {
    return { error: "Published work calendar did not return calendar data." };
  }
  const events = (message.RootFolder.Items ?? []).map(formatEvent);
  return { start_date: startDate, end_date: lastDay, count: events.length, events };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "2026-10-27T08:30:00-07:00" → "2026-10-27 08:30" in local time; other formats unchanged. */
function localWhen(value: string): string {
  if (!/[T ]\d{2}:\d{2}/.test(value) || !/(Z|[+-]\d{2}:?\d{2})$/.test(value)) return value.replace("T", " ").slice(0, 16);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** What the model reads: one line per event. The full result stays in `details`. */
export function calendarView(result: unknown): unknown {
  const r = result as { calendar?: string; start_date?: string; end_date?: string; count?: number; events?: Array<Record<string, unknown>> };
  if (!Array.isArray(r?.events)) return result;
  const head = `${r.calendar ? `${r.calendar}: ` : ""}${r.count ?? r.events.length} events, ${r.start_date} to ${r.end_date}`;
  const lines = r.events.map((e) => {
    const start = localWhen(String(e.start ?? ""));
    const end = localWhen(String(e.end ?? ""));
    const span = end && end !== start ? `${start}–${end.startsWith(start.slice(0, 10)) ? end.slice(11) : end}` : start;
    const title = String(e.summary ?? e.subject ?? "(no title)");
    const where = e.location ? ` @ ${String(e.location)}` : "";
    const busy = e.busy_type && String(e.busy_type).toLowerCase() !== "busy" ? ` (${String(e.busy_type)})` : "";
    return `${span} ${title}${where}${busy}`;
  });
  return [head, ...lines].join("\n");
}
