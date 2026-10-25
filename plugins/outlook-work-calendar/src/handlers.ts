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

function httpPost(url: string, body: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.request(url, { method: "POST", headers, timeout: 30_000 }, res => {
      let data = ""; res.on("data", (c: Buffer) => data += c); res.on("end", () => resolve(data));
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

function extractEvents(response: unknown): unknown[] {
  try {
    const body = (response as Record<string, unknown>).Body as Record<string, unknown>;
    const items = (body?.ResponseMessages as Record<string, unknown>)?.Items as Array<Record<string, unknown>>;
    return ((items?.[0]?.RootFolder as Record<string, unknown>)?.Items as unknown[]) ?? [];
  } catch { return []; }
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

export async function fetchWorkCalendar(
  config: OutlookWorkCalendarConfig,
  params: { days?: number; after?: string; before?: string },
): Promise<unknown> {
  const { calendarUrl, folderId } = config;
  if (!calendarUrl) return { error: "OUTLOOK_WORK_CALENDAR_URL is not set" };
  if (!folderId) return { error: "OUTLOOK_WORK_FOLDER_ID is not set" };
  // Use local date (America/Los_Angeles) — toISOString() would give UTC and shift the
  // window forward by ~7h in the evening, dropping same-day events.
  const toLocalDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

  // An explicit date range wins over the rolling `days` window, so past dates
  // and arbitrary future ranges are reachable — `days` alone can only look
  // forward from today.
  let startDate: string;
  let endDate: string;
  if (params.after || params.before) {
    startDate = params.after ?? toLocalDate(new Date());
    // `before` names a day the caller wants included; the EWS page view end is
    // exclusive, so run to the following midnight.
    endDate = addDays(params.before ?? addDays(startDate, params.days ?? 7), 1);
  } else {
    const days = params.days ?? 7;
    startDate = toLocalDate(new Date());
    endDate = toLocalDate(new Date(Date.now() + days * 86_400_000));
  }
  const url = `${calendarUrl}/service.svc?action=FindItem&app=PublishedCalendar&n=18`;
  const body = JSON.stringify(buildRequestBody(folderId, startDate, endDate));
  const res = await httpPost(url, body, { "Content-Type": "application/json; charset=utf-8", "Action": "FindItem", "User-Agent": "Mozilla/5.0" });
  const data = JSON.parse(res);
  const events = extractEvents(data).map(e => formatEvent(e as Record<string, unknown>));
  return { start_date: startDate, end_date: addDays(endDate, -1), count: events.length, events };
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
