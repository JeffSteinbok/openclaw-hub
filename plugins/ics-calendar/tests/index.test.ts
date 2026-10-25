import { describe, it, expect, vi, afterEach } from "vitest";
import https from "node:https";
import http from "node:http";
import { EventEmitter } from "node:events";

afterEach(() => vi.restoreAllMocks());

function mockHttp(body: string, statusCode = 200) {
  const res = new EventEmitter() as NodeJS.EventEmitter & { statusCode: number };
  res.statusCode = statusCode;
  const req = new EventEmitter() as NodeJS.EventEmitter & { destroy: () => void };
  req.destroy = vi.fn();
  vi.spyOn(http, "get").mockImplementationOnce((_url, _opts, cb) => {
    if (cb) cb(res as Parameters<typeof cb>[0]);
    setTimeout(() => { res.emit("data", Buffer.from(body)); res.emit("end"); }, 0);
    return req as unknown as ReturnType<typeof http.get>;
  });
  vi.spyOn(https, "get").mockImplementationOnce((_url, _opts, cb) => {
    if (cb) cb(res as Parameters<typeof cb>[0]);
    setTimeout(() => { res.emit("data", Buffer.from(body)); res.emit("end"); }, 0);
    return req as unknown as ReturnType<typeof https.get>;
  });
}

interface ToolDef { name: string; description: string; execute: (id: string, params: Record<string, unknown>) => Promise<unknown> }
function makeApi(config: Record<string, unknown> = {}) {
  const tools: Record<string, ToolDef> = {};
  return { pluginConfig: config, registerTool(t: unknown) { const td = t as ToolDef; tools[td.name] = td; }, tools };
}
function resultText(r: unknown) { return JSON.parse((r as { content: Array<{text:string}> }).content[0].text); }

async function loadPlugin(config: Record<string, unknown> = {}) {
  const { createEntry } = await import("../src/index.js");
  const entry = createEntry();
  const api = makeApi(config);
  entry.register(api);
  return { entry, api };
}

// Use a date 2 days from now so it's always in a 30-day window but not 7-day default
const NEAR_DATE = new Date(Date.now() + 2*86400000);
const NEAR_DT = `${NEAR_DATE.getFullYear()}${String(NEAR_DATE.getMonth()+1).padStart(2,'0')}${String(NEAR_DATE.getDate()).padStart(2,'0')}T100000`;
// Use a date 60 days from now — outside any normal test window
const FAR_DATE = new Date(Date.now() + 60*86400000);
const FAR_DT = `${FAR_DATE.getFullYear()}${String(FAR_DATE.getMonth()+1).padStart(2,'0')}${String(FAR_DATE.getDate()).padStart(2,'0')}T120000`;

const ICS_BODY = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:${NEAR_DT}
DTEND:${NEAR_DT.replace('T100000','T110000')}
SUMMARY:Team Standup
LOCATION:Zoom
UID:abc123@example.com
END:VEVENT
BEGIN:VEVENT
DTSTART:${FAR_DT}
DTEND:${FAR_DT.replace('T120000','T130000')}
SUMMARY:Future Event
UID:def456@example.com
END:VEVENT
END:VCALENDAR`;

describe("plugin entry", () => {
  it("has correct id and name", async () => {
    const { entry } = await loadPlugin();
    expect(entry.id).toBe("ics-calendar");
    expect(entry.name).toBe("ICS Calendar");
  });

  it("registers ics_calendar_fetch", async () => {
    const { api } = await loadPlugin();
    expect(api.tools["ics_calendar_fetch"]).toBeDefined();
  });
});

describe("ics_calendar_fetch", () => {
  it("returns error when neither calendar_id nor url provided", async () => {
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["ics_calendar_fetch"].execute("id", {}));
    expect(data).toHaveProperty("error");
  });

  it("fetches and parses events from a URL", async () => {
    const { api } = await loadPlugin();
    mockHttp(ICS_BODY);
    const data = resultText(await api.tools["ics_calendar_fetch"].execute("id", { url: "http://example.com/cal.ics", label: "Test", days: 30 }));
    expect(data.calendar).toBe("Test");
    expect(data.count).toBe(1); // only the near-future event
    expect(data.events[0].summary).toBe("Team Standup");
    expect(data.events[0].location).toBe("Zoom");
  });

  it("limits to after/before (inclusive, local days)", async () => {
    const { api } = await loadPlugin();
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART:20261026T235900
SUMMARY:Late on the 26th
UID:a
END:VEVENT
BEGIN:VEVENT
DTSTART:20261027T090000
DTEND:20261027T100000
SUMMARY:On the 27th
UID:b
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261028
SUMMARY:All day on the 28th
UID:c
END:VEVENT
END:VCALENDAR`;
    mockHttp(ics);
    const one = resultText(await api.tools["ics_calendar_fetch"].execute("id", { url: "http://example.com/c.ics", after: "2026-10-27", before: "2026-10-27" }));
    expect(one).toMatchObject({ start_date: "2026-10-27", end_date: "2026-10-28", days: 1, count: 1 });
    expect(one.events[0]).toMatchObject({ summary: "On the 27th", start: "2026-10-27 09:00", end: "2026-10-27 10:00" });
    mockHttp(ics);
    const two = resultText(await api.tools["ics_calendar_fetch"].execute("id", { url: "http://example.com/c.ics", after: "2026-10-27", before: "2026-10-28" }));
    expect(two.events.map((e: { start: string }) => e.start)).toEqual(["2026-10-27 09:00", "2026-10-28"]);
  });

  it("converts UTC times to local wall time", async () => {
    const { api } = await loadPlugin();
    mockHttp(`BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART:20261027T160000Z
SUMMARY:UTC
UID:u
END:VEVENT
END:VCALENDAR`);
    const data = resultText(await api.tools["ics_calendar_fetch"].execute("id", { url: "http://example.com/c.ics", after: "2026-10-26", before: "2026-10-28" }));
    const local = new Date("2026-10-27T16:00:00Z");
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(data.events[0].start).toBe(`${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())} ${pad(local.getHours())}:${pad(local.getMinutes())}`);
  });

  it("rejects bad dates", async () => {
    const { api } = await loadPlugin();
    expect(resultText(await api.tools["ics_calendar_fetch"].execute("id", { url: "http://example.com/c.ics", after: "tomorrow" })).error).toMatch(/YYYY-MM-DD/);
    expect(resultText(await api.tools["ics_calendar_fetch"].execute("id", { url: "http://example.com/c.ics", after: "2026-10-28", before: "2026-10-27" })).error).toMatch(/on or after/);
  });

  it("returns error when calendar_id not found in config", async () => {
    const { api } = await loadPlugin({ calendars: [] });
    const data = resultText(await api.tools["ics_calendar_fetch"].execute("id", { calendar_id: "personal" }));
    expect(data).toMatchObject({ error: expect.stringContaining("personal") });
  });

  it("resolves calendar_id from config", async () => {
    const { api } = await loadPlugin({ calendars: [{ id: "personal", label: "Personal", url: "http://example.com/personal.ics" }] });
    mockHttp(ICS_BODY);
    const data = resultText(await api.tools["ics_calendar_fetch"].execute("id", { calendar_id: "personal", days: 30 }));
    expect(data.calendar).toBe("Personal");
  });

  it("surfaces HTTP errors", async () => {
    const { api } = await loadPlugin();
    const res = new EventEmitter() as NodeJS.EventEmitter & { statusCode: number };
    res.statusCode = 404;
    const req = new EventEmitter() as NodeJS.EventEmitter & { destroy: () => void };
    req.destroy = vi.fn();
    vi.spyOn(http, "get").mockImplementationOnce((_url, _opts, cb) => {
      if (cb) cb(res as Parameters<typeof cb>[0]);
      setTimeout(() => { res.emit("data", Buffer.from("Not found")); res.emit("end"); }, 0);
      return req as unknown as ReturnType<typeof http.get>;
    });
    vi.spyOn(https, "get").mockImplementationOnce((_url, _opts, cb) => {
      if (cb) cb(res as Parameters<typeof cb>[0]);
      setTimeout(() => { res.emit("data", Buffer.from("Not found")); res.emit("end"); }, 0);
      return req as unknown as ReturnType<typeof https.get>;
    });
    const data = resultText(await api.tools["ics_calendar_fetch"].execute("id", { url: "http://example.com/cal.ics", days: 7 }));
    expect(data).toHaveProperty("error");
  });
});
