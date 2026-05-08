/**
 * ICS Calendar — core handlers.
 *
 * Pure logic with no knowledge of how it's invoked (plugin vs CLI).
 * Config is passed in; handlers never read env vars or plugin APIs directly.
 */

import https from "node:https";
import http from "node:http";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CalendarConfig {
  id: string;
  label: string;
  url: string;
}

export interface IcsCalendarConfig {
  calendars: CalendarConfig[];
}

export interface CalendarEvent {
  summary: string;
  start: string;
  end: string;
  location?: string;
  organizer?: string;
  description?: string;
  uid: string;
}

export interface CalendarFetchResult {
  calendar: string;
  days: number;
  start_date: string;
  end_date: string;
  count: number;
  events: CalendarEvent[];
}

export interface CalendarError {
  error: string;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

export function httpGet(url: string, ms = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { timeout: ms }, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => (data += c));
      res.on("end", () => {
        if ((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300) resolve(data);
        else reject(new Error(`HTTP ${res.statusCode}`));
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

// ---------------------------------------------------------------------------
// ICS parsing helpers
// ---------------------------------------------------------------------------

function parseDt(s: string): Date | null {
  s = s.trim();
  if (s.includes(":")) s = s.split(":").pop()!;
  s = s.replace(/Z$/, "");
  if (/^\d{8}T\d{6}$/.test(s)) {
    return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}`);
  }
  if (/^\d{8}$/.test(s)) return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`);
  return null;
}

function unescape(s: string): string {
  return s.replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function parseEvents(ics: string, startDt: Date, endDt: Date): Array<Record<string, string>> {
  const events: Array<Record<string, string>> = [];
  let inEvent = false,
    current: Record<string, string> = {},
    prevKey = "";
  for (const raw of ics.split(/\r?\n/)) {
    if (/^[ \t]/.test(raw) && prevKey) {
      current[prevKey] = (current[prevKey] ?? "") + raw.slice(1);
      continue;
    }
    const line = raw.trim();
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      current = {};
      prevKey = "";
    } else if (line === "END:VEVENT") {
      inEvent = false;
      const dtstart = current["DTSTART"];
      if (dtstart) {
        const dt = parseDt(dtstart);
        if (dt && dt >= startDt && dt < endDt) events.push(current);
      }
      prevKey = "";
    } else if (inEvent && line.includes(":")) {
      const [k, ...rest] = line.split(":");
      const key = k.split(";")[0];
      current[key] = rest.join(":");
      prevKey = key;
    } else prevKey = "";
  }
  return events;
}

function fmtDt(s: string): string {
  const dt = parseDt(s);
  if (!dt) return s;
  return s.includes("T") ? dt.toISOString().slice(0, 16).replace("T", " ") : dt.toISOString().slice(0, 10);
}

export function resolveUrl(url: string): string {
  return url.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? "");
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function fetchCalendarEvents(
  params: { calendar_id?: string; url?: string; label?: string; days?: number },
  config: IcsCalendarConfig,
): Promise<CalendarFetchResult | CalendarError> {
  const days = Number(params.days ?? 7);
  const startDt = new Date();
  startDt.setHours(0, 0, 0, 0);
  const endDt = new Date(startDt.getTime() + days * 86400000);

  let icsUrl: string | undefined;
  let label: string = "Calendar";

  if (params.url) {
    icsUrl = resolveUrl(String(params.url));
    label = String(params.label ?? params.url);
  } else if (params.calendar_id) {
    const cals = config.calendars;
    const cal = cals.find((c) => c.id === params.calendar_id);
    if (!cal) return { error: `Calendar '${params.calendar_id}' not found. Available: ${cals.map((c) => c.id).join(", ")}` };
    icsUrl = resolveUrl(cal.url);
    label = cal.label;
  } else {
    return { error: "calendar_id or url is required" };
  }

  if (!icsUrl) return { error: "Calendar URL is empty or env var not set" };

  const ics = await httpGet(icsUrl);
  const events = parseEvents(ics, startDt, endDt);
  const formatted: CalendarEvent[] = events.map((e) => ({
    summary: unescape(e["SUMMARY"] ?? "No subject"),
    start: fmtDt(e["DTSTART"] ?? ""),
    end: fmtDt(e["DTEND"] ?? ""),
    location: unescape(e["LOCATION"] ?? "") || undefined,
    organizer: (e["ORGANIZER"] ?? "").replace("mailto:", "") || undefined,
    description: unescape(e["DESCRIPTION"] ?? "").split("\n")[0].trim() || undefined,
    uid: e["UID"] ?? "",
  }));

  return {
    calendar: label,
    days,
    start_date: startDt.toISOString().slice(0, 10),
    end_date: endDt.toISOString().slice(0, 10),
    count: formatted.length,
    events: formatted,
  };
}
