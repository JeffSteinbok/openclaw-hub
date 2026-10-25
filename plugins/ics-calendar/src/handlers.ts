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

/**
 * DTSTART/DTEND value → Date. `...Z` is UTC; other date-times (floating or
 * TZID, which isn't resolved) are taken as the host's local time; a bare date
 * is local midnight.
 */
function parseDt(s: string): Date | null {
  s = s.trim();
  if (s.includes(":")) s = s.split(":").pop()!;
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(s);
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00", sec = "00", utc] = m;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${sec}${utc ? "Z" : ""}`);
}

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

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
  // Local wall time, like the inputs (UTC times are converted).
  return s.includes("T") ? `${localDate(dt)} ${pad(dt.getHours())}:${pad(dt.getMinutes())}` : localDate(dt);
}

export function resolveUrl(url: string): string {
  return url.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? "");
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function fetchCalendarEvents(
  params: { calendar_id?: string; url?: string; label?: string; days?: number; after?: string; before?: string },
  config: IcsCalendarConfig,
): Promise<CalendarFetchResult | CalendarError> {
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  for (const key of ["after", "before"] as const) {
    if (params[key] !== undefined && !isoDate.test(params[key]!)) return { error: `${key} must be a date (YYYY-MM-DD)` };
  }
  // Local midnight of the first day; the end is exclusive.
  const startDt = params.after ? new Date(`${params.after}T00:00:00`) : new Date();
  startDt.setHours(0, 0, 0, 0);
  let days = Number(params.days ?? 7);
  if (params.before) {
    const last = new Date(`${params.before}T00:00:00`);
    if (last < startDt) return { error: "before must be on or after after" };
    days = Math.round((last.getTime() - startDt.getTime()) / 86400000) + 1;
  }
  const endDt = new Date(startDt);
  endDt.setDate(endDt.getDate() + days);

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
    start_date: localDate(startDt),
    end_date: localDate(endDt),
    count: formatted.length,
    events: formatted,
  };
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
