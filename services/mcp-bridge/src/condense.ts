/**
 * condense.ts — built-in condensers that turn raw OpenClaw tool output into the
 * little an outside agent needs. Raw Home Assistant state for a house is easily
 * ~90 KB; the condensed status is ~1 KB.
 *
 * Each condenser gets one result per configured call, in order, with the call's
 * label and arguments, and returns text for the client.
 */

export interface CallResult {
  tool: string;
  label?: string;
  args: Record<string, unknown>;
  output: unknown;
}

type Condenser = (results: CallResult[], opts: { ignoreEntities: string[] }) => string;

interface HaEntity {
  entity_id: string;
  state: string;
  attributes?: Record<string, unknown>;
}

function entitiesOf(output: unknown): HaEntity[] {
  const o = output as { output?: unknown };
  const list = Array.isArray(o?.output) ? o.output : Array.isArray(output) ? output : [];
  return list.filter((e): e is HaEntity => !!e && typeof (e as HaEntity).entity_id === "string");
}

function globToRegExp(glob: string): RegExp {
  return new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
}

const name = (e: HaEntity) => String(e.attributes?.["friendly_name"] ?? e.entity_id);
const IDLE = new Set(["off", "unavailable", "unknown", "standby", "idle", "closed"]);

/** Home Assistant state lists → "what's on / open / set" lines, grouped by domain. */
const homeAssistantStatus: Condenser = (results, { ignoreEntities }) => {
  const ignore = ignoreEntities.map(globToRegExp);
  const lines: string[] = [];
  for (const r of results) {
    const entities = entitiesOf(r.output).filter((e) => !ignore.some((re) => re.test(e.entity_id)));
    const domain = String(r.args["domain"] ?? r.label ?? "entities");
    if (domain === "climate") {
      for (const e of entities) {
        const target = e.attributes?.["temperature"] ?? e.attributes?.["target_temp_low"];
        const current = e.attributes?.["current_temperature"];
        lines.push(
          `${name(e)}: ${e.state}${target !== undefined ? `, set to ${target}` : ""}${current !== undefined ? `, currently ${current}` : ""}`,
        );
      }
      continue;
    }
    const active = entities.filter((e) => !IDLE.has(e.state));
    const label = r.label ?? domain;
    if (domain === "light" || domain === "switch" || domain === "fan") {
      lines.push(`${label} on: ${active.length ? active.map(name).join(", ") : "none"}`);
    } else {
      lines.push(`${label}: ${active.length ? active.map((e) => `${name(e)} (${e.state})`).join(", ") : "none"}`);
    }
  }
  return lines.join("\n");
};

interface CalendarEvent {
  summary?: string;
  subject?: string;
  start?: string;
  end?: string;
  location?: string;
  is_all_day?: boolean;
}

/** Calendar fetch results → one sorted line per event: start, title, calendar. */
const calendarEvents: Condenser = (results) => {
  const rows: { start: string; line: string }[] = [];
  for (const r of results) {
    const events = ((r.output as { events?: CalendarEvent[] })?.events ?? []) as CalendarEvent[];
    for (const e of events) {
      const title = e.summary ?? e.subject ?? "(no title)";
      const when = e.is_all_day ? `${(e.start ?? "").slice(0, 10)} (all day)` : (e.start ?? "");
      rows.push({
        start: e.start ?? "",
        line: `${when} — ${title}${r.label ? ` [${r.label}]` : ""}${e.location ? ` @ ${e.location}` : ""}`,
      });
    }
  }
  rows.sort((a, b) => a.start.localeCompare(b.start));
  return rows.length ? rows.map((r) => r.line).join("\n") : "No events.";
};

export const CONDENSERS: Record<string, Condenser> = {
  "home-assistant-status": homeAssistantStatus,
  "calendar-events": calendarEvents,
};
