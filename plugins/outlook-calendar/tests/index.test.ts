import { describe, it, expect, vi, afterEach } from "vitest";
import https from "node:https";
import { EventEmitter } from "node:events";

afterEach(() => vi.restoreAllMocks());

function mockHttps(body: string, statusCode = 200) {
  const res = new EventEmitter() as NodeJS.EventEmitter & { statusCode: number };
  res.statusCode = statusCode;
  const req = new EventEmitter() as NodeJS.EventEmitter & { destroy:()=>void; end:()=>void; write:()=>void };
  req.destroy = vi.fn(); req.end = vi.fn(); req.write = vi.fn();
  vi.spyOn(https, "request").mockImplementationOnce((_url, _opts, cb) => {
    if (cb) cb(res as Parameters<typeof cb>[0]);
    setTimeout(() => { res.emit("data", Buffer.from(body)); res.emit("end"); }, 0);
    return req as unknown as ReturnType<typeof https.request>;
  });
}

interface ToolDef { name: string; description: string; execute: (id: string, params: Record<string,unknown>) => Promise<unknown> }
function makeApi() {
  const tools: Record<string,ToolDef> = {};
  return { pluginConfig: {}, registerTool(t: unknown) { tools[(t as ToolDef).name] = t as ToolDef; }, tools };
}
function resultText(r: unknown) { return JSON.parse((r as { content: Array<{text:string}> }).content[0].text); }

async function loadPlugin() {
  const { createEntry } = await import("../src/index.js");
  const entry = createEntry();
  const api = makeApi();
  entry.register(api);
  return { entry, api };
}

const TOKEN_RESPONSE = JSON.stringify({ access_token: "test-token" });
const CALENDARS_RESPONSE = JSON.stringify({ value: [{ name: "calendar", id: "cal-1" }, { name: "Your Family", id: "fam-1" }] });
const EVENTS_RESPONSE = JSON.stringify({ value: [
  { subject: "Team Standup", start: { dateTime: "2026-05-03T17:00:00Z", timeZone: "UTC" }, end: { dateTime: "2026-05-03T17:30:00Z", timeZone: "UTC" },
    location: { displayName: "Zoom" }, organizer: { emailAddress: { name: "Jeff", address: "jeff@test.com" } }, attendees: [], responseStatus: { response: "accepted" }, showAs: "busy" },
]});
const EVENTS_WITH_BODY_RESPONSE = JSON.stringify({ value: [
  { subject: "Team Standup", start: { dateTime: "2026-05-03T17:00:00Z", timeZone: "UTC" }, end: { dateTime: "2026-05-03T17:30:00Z", timeZone: "UTC" },
    location: { displayName: "Zoom" }, organizer: { emailAddress: { name: "Jeff", address: "jeff@test.com" } }, attendees: [], responseStatus: { response: "accepted" }, showAs: "busy",
    body: { contentType: "html", content: "<div>Agenda&nbsp;item 1<br>https://teams.example/join</div>" } },
]});

describe("plugin entry", () => {
  it("has correct id and name", async () => {
    const { entry } = await loadPlugin();
    expect(entry.id).toBe("outlook-calendar");
    expect(entry.name).toBe("Outlook Calendar");
  });

  it("registers outlook_calendar_fetch", async () => {
    const { api } = await loadPlugin();
    expect(api.tools["outlook_calendar_fetch"]).toBeDefined();
  });
});

describe("outlook_calendar_fetch", () => {
  it("returns error when credentials missing", async () => {
    const OLD = process.env.OUTLOOK_CLIENT_ID;
    delete process.env.OUTLOOK_CLIENT_ID;
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["outlook_calendar_fetch"].execute("id", {}));
    expect(data).toHaveProperty("error");
    if (OLD) process.env.OUTLOOK_CLIENT_ID = OLD;
  });

  it("fetches and returns calendar data", async () => {
    process.env.OUTLOOK_CLIENT_ID = "cid";
    process.env.OUTLOOK_CLIENT_SECRET = "csec";
    process.env.OUTLOOK_REFRESH_TOKEN = "rtoken";
    // token → calendars → events
    mockHttps(TOKEN_RESPONSE);
    mockHttps(CALENDARS_RESPONSE);
    mockHttps(EVENTS_RESPONSE);
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["outlook_calendar_fetch"].execute("id", { calendar: "personal", days: 7 })) as Record<string, unknown>;
    expect(data).toHaveProperty("personal");
  });

  it("includes plain-text body content when an event description exists", async () => {
    process.env.OUTLOOK_CLIENT_ID = "cid";
    process.env.OUTLOOK_CLIENT_SECRET = "csec";
    process.env.OUTLOOK_REFRESH_TOKEN = "rtoken";
    mockHttps(TOKEN_RESPONSE);
    mockHttps(CALENDARS_RESPONSE);
    mockHttps(EVENTS_WITH_BODY_RESPONSE);
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["outlook_calendar_fetch"].execute("id", { calendar: "personal", days: 7 })) as {
      personal: { events: Array<Record<string, unknown>> };
    };
    expect(data.personal.events[0]?.body).toBe("Agenda item 1 https://teams.example/join");
  });
});
