/**
 * ICS Calendar plugin — pure TS-native implementation.
 * Fetches and parses ICS feeds, filters by date range, returns structured events.
 */

import https from "node:https";
import http from "node:http";
import { Type } from "@sinclair/typebox";

type PluginApi = { registerTool: (t: unknown) => void; pluginConfig?: Record<string, unknown> };

interface CalendarConfig { id: string; label: string; url: string }

function httpGet(url: string, ms = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, {timeout: ms}, res => {
      let data = ""; res.on("data", (c: Buffer) => data += c); res.on("end", () => {
        if ((res.statusCode??0) >= 200 && (res.statusCode??0) < 300) resolve(data);
        else reject(new Error(`HTTP ${res.statusCode}`));
      });
    });
    req.on("error", reject); req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function parseDt(s: string): Date | null {
  s = s.trim();
  if (s.includes(":")) s = s.split(":").pop()!;
  s = s.replace(/Z$/, "");
  if (/^\d{8}T\d{6}$/.test(s)) {
    return new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(9,11)}:${s.slice(11,13)}:${s.slice(13,15)}`);
  }
  if (/^\d{8}$/.test(s)) return new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`);
  return null;
}

function unescape(s: string): string {
  return s.replace(/\\n/g,"\n").replace(/\\,/g,",").replace(/\\;/g,";").replace(/\\\\/g,"\\");
}

function parseEvents(ics: string, startDt: Date, endDt: Date): Array<Record<string,string>> {
  const events: Array<Record<string,string>> = [];
  let inEvent = false, current: Record<string,string> = {}, prevKey = "";
  for (const raw of ics.split(/\r?\n/)) {
    if (/^[ \t]/.test(raw) && prevKey) { current[prevKey] = (current[prevKey]??"") + raw.slice(1); continue; }
    const line = raw.trim();
    if (line === "BEGIN:VEVENT") { inEvent = true; current = {}; prevKey = ""; }
    else if (line === "END:VEVENT") {
      inEvent = false;
      const dtstart = current["DTSTART"];
      if (dtstart) { const dt = parseDt(dtstart); if (dt && dt >= startDt && dt < endDt) events.push(current); }
      prevKey = "";
    } else if (inEvent && line.includes(":")) {
      const [k, ...rest] = line.split(":"); const key = k.split(";")[0]; current[key] = rest.join(":");
      prevKey = key;
    } else prevKey = "";
  }
  return events;
}

function fmtDt(s: string): string {
  const dt = parseDt(s); if (!dt) return s;
  return s.includes("T") ? dt.toISOString().slice(0,16).replace("T"," ") : dt.toISOString().slice(0,10);
}

function resolveUrl(url: string): string {
  // Expand ${ENV_VAR} patterns
  return url.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? "");
}

function fmt(data: unknown) { return {content:[{type:"text" as const, text:JSON.stringify(data)}], details:{}}; }

const configSchema = {
  type:"object" as const, additionalProperties:false, properties:{
    calendars:{type:"array" as const, items:{type:"object" as const}, description:"List of calendar configs with id, label, url"},
  },
};

export function createEntry() {
  return {
    id:"ics-calendar", name:"ICS Calendar",
    description:"Fetch upcoming events from a published ICS calendar feed",
    configSchema,
    register(api: PluginApi) {
      const getCalendars = (): CalendarConfig[] => {
        const raw = api.pluginConfig?.calendars as Array<{id:string;label:string;url:string}>|undefined;
        return raw ?? [];
      };

      api.registerTool({ name:"ics_calendar_fetch", label:"ICS Calendar Fetch",
        description:"Fetch upcoming events from a published ICS calendar feed.",
        parameters: Type.Object({
          calendar_id: Type.Optional(Type.String({description:"Configured calendar id from plugin config"})),
          url: Type.Optional(Type.String({description:"Direct ICS URL override for one-off fetches"})),
          label: Type.Optional(Type.String({description:"Optional display label when using a direct URL override"})),
          days: Type.Optional(Type.Integer({description:"Number of days ahead to fetch (default 7)", default:7})),
        }),
        async execute(_id:string, p:Record<string,unknown>) {
          try {
            const days = Number(p.days??7);
            const startDt = new Date(); startDt.setHours(0,0,0,0);
            const endDt = new Date(startDt.getTime() + days*86400000);

            let icsUrl: string|undefined, label: string = "Calendar";

            if (p.url) {
              icsUrl = resolveUrl(String(p.url));
              label = String(p.label??p.url);
            } else if (p.calendar_id) {
              const cals = getCalendars();
              const cal = cals.find(c => c.id === p.calendar_id);
              if (!cal) return fmt({error:`Calendar '${p.calendar_id}' not found. Available: ${cals.map(c=>c.id).join(", ")}`});
              icsUrl = resolveUrl(cal.url);
              label = cal.label;
            } else {
              return fmt({error:"calendar_id or url is required"});
            }

            if (!icsUrl) return fmt({error:"Calendar URL is empty or env var not set"});
            const ics = await httpGet(icsUrl);
            const events = parseEvents(ics, startDt, endDt);
            const formatted = events.map(e => ({
              summary: unescape(e["SUMMARY"]??"No subject"),
              start: fmtDt(e["DTSTART"]??""),
              end: fmtDt(e["DTEND"]??""),
              location: unescape(e["LOCATION"]??"") || undefined,
              organizer: (e["ORGANIZER"]??"").replace("mailto:","") || undefined,
              description: unescape(e["DESCRIPTION"]??"").split("\n")[0].trim() || undefined,
              uid: e["UID"]??"",
            }));
            return fmt({calendar:label, days, start_date:startDt.toISOString().slice(0,10), end_date:endDt.toISOString().slice(0,10), count:formatted.length, events:formatted});
          } catch(e) { return fmt({error:(e as Error).message}); }
        },
      });
    },
  };
}
