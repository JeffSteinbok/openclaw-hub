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

export async function fetchWorkCalendar(
  config: OutlookWorkCalendarConfig,
  params: { days?: number },
): Promise<unknown> {
  const { calendarUrl, folderId } = config;
  if (!calendarUrl) return { error: "OUTLOOK_WORK_CALENDAR_URL is not set" };
  if (!folderId) return { error: "OUTLOOK_WORK_FOLDER_ID is not set" };
  const days = params.days ?? 7;
  // Use local date (America/Los_Angeles) — toISOString() would give UTC and shift the
  // window forward by ~7h in the evening, dropping same-day events.
  const toLocalDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const startDate = toLocalDate(new Date());
  const endDate = toLocalDate(new Date(Date.now() + days * 86_400_000));
  const url = `${calendarUrl}/service.svc?action=FindItem&app=PublishedCalendar&n=18`;
  const body = JSON.stringify(buildRequestBody(folderId, startDate, endDate));
  const res = await httpPost(url, body, { "Content-Type": "application/json; charset=utf-8", "Action": "FindItem", "User-Agent": "Mozilla/5.0" });
  const data = JSON.parse(res);
  const events = extractEvents(data).map(e => formatEvent(e as Record<string, unknown>));
  return { start_date: startDate, end_date: endDate, count: events.length, events };
}
