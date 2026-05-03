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

const ICS_BODY = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:20260503T100000
DTEND:20260503T110000
SUMMARY:Team Standup
LOCATION:Zoom
UID:abc123@example.com
END:VEVENT
BEGIN:VEVENT
DTSTART:20260601T120000
DTEND:20260601T130000
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
