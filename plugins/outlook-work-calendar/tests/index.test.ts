import { describe, it, expect, vi, afterEach } from "vitest";
import http from "node:http";
import https from "node:https";
import { EventEmitter } from "node:events";

afterEach(() => vi.restoreAllMocks());

function mockHttp(body: string, statusCode = 200) {
  const res = new EventEmitter() as NodeJS.EventEmitter & { statusCode: number };
  res.statusCode = statusCode;
  const req = new EventEmitter() as NodeJS.EventEmitter & { destroy:()=>void; end:()=>void; write:()=>void };
  req.destroy = vi.fn(); req.end = vi.fn(); req.write = vi.fn();
  [http, https].forEach(mod => vi.spyOn(mod, "request").mockImplementationOnce((_url, _opts, cb) => {
    if (cb) cb(res as Parameters<typeof cb>[0]);
    setTimeout(() => { res.emit("data", Buffer.from(body)); res.emit("end"); }, 0);
    return req as unknown as ReturnType<typeof http.request>;
  }));
}

interface ToolDef { name: string; execute: (id: string, params: Record<string,unknown>) => Promise<unknown> }
function makeApi() { const tools: Record<string,ToolDef> = {}; return { pluginConfig:{}, registerTool(t:unknown){tools[(t as ToolDef).name]=t as ToolDef;}, tools }; }
function resultText(r: unknown) { return JSON.parse((r as { content: Array<{text:string}> }).content[0].text); }
async function loadPlugin() { const { createEntry } = await import("../src/index.js"); const entry = createEntry(); const api = makeApi(); entry.register(api); return { entry, api }; }

const WORK_EVENTS_RESPONSE = JSON.stringify({
  Body: { ResponseMessages: { Items: [{ RootFolder: { Items: [
    { Subject: "1:1 with Manager", Start: "2026-05-03T10:00:00", End: "2026-05-03T10:30:00", Location: { DisplayName: "Teams" }, FreeBusyType: "Busy", IsAllDayEvent: false, Sensitivity: "Normal" },
  ]}}]}}
});

describe("plugin entry", () => {
  it("has correct id and name", async () => { const { entry } = await loadPlugin(); expect(entry.id).toBe("outlook-work-calendar"); });
  it("registers outlook_work_calendar_fetch", async () => { const { api } = await loadPlugin(); expect(api.tools["outlook_work_calendar_fetch"]).toBeDefined(); });
});

describe("outlook_work_calendar_fetch", () => {
  it("returns error when env vars missing", async () => {
    const OLD_URL = process.env.OUTLOOK_WORK_CALENDAR_URL;
    delete process.env.OUTLOOK_WORK_CALENDAR_URL;
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["outlook_work_calendar_fetch"].execute("id", {}));
    expect(data).toHaveProperty("error");
    if (OLD_URL) process.env.OUTLOOK_WORK_CALENDAR_URL = OLD_URL;
  });

  it("fetches and returns work calendar events", async () => {
    process.env.OUTLOOK_WORK_CALENDAR_URL = "https://outlook.office365.com/owa/calendar/abc";
    process.env.OUTLOOK_WORK_FOLDER_ID = "folder-123";
    mockHttp(WORK_EVENTS_RESPONSE);
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["outlook_work_calendar_fetch"].execute("id", { days: 7 })) as { count: number; events: Array<Record<string,unknown>> };
    expect(data.count).toBe(1);
    expect(data.events[0].subject).toContain("1:1");
    expect(data.events[0].location).toBe("Teams");
  });
});
