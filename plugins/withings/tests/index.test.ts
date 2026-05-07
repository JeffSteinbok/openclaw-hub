import { describe, it, expect, vi, afterEach } from "vitest";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";

afterEach(() => vi.restoreAllMocks());

// LIFO: register in reverse
function mockHttpsSeq(...responses: Array<[string, number]>) {
  for (const [body, status] of [...responses].reverse()) {
    const res = new EventEmitter() as NodeJS.EventEmitter & { statusCode: number };
    res.statusCode = status;
    const req = new EventEmitter() as NodeJS.EventEmitter & { destroy:()=>void; end:()=>void; write:()=>void };
    req.destroy = vi.fn(); req.end = vi.fn(); req.write = vi.fn();
    vi.spyOn(https, "request").mockImplementationOnce((_url, _opts, cb) => {
      if (cb) cb(res as Parameters<typeof cb>[0]);
      setTimeout(() => { res.emit("data", Buffer.from(body)); res.emit("end"); }, 0);
      return req as unknown as ReturnType<typeof https.request>;
    });
  }
}

interface ToolDef { name: string; execute: (id: string, params: Record<string,unknown>) => Promise<unknown> }
function makeApi(config: Record<string,unknown> = {}) { const tools: Record<string,ToolDef> = {}; return { pluginConfig:{...config}, registerTool(t:unknown){tools[(t as ToolDef).name]=t as ToolDef;}, tools }; }
function resultText(r: unknown) { return JSON.parse((r as { content: Array<{text:string}> }).content[0].text); }
async function loadPlugin(config: Record<string,unknown> = {}) {
  const { createEntry } = await import("../src/index.js");
  const entry = createEntry();
  const api = makeApi(config);
  entry.register(api);
  return { entry, api };
}

const HOME = process.env.HOME ?? "/home/openclaw";
const TOKEN_FILE = path.join(HOME, ".openclaw/withings_tokens.json");
const FAKE_TOKENS = JSON.stringify({ access_token: "test-access", refresh_token: "test-refresh", expires_at: Date.now()/1000 + 3600, userid: "12345" });

const MEAS_RESPONSE = JSON.stringify({ status: 0, body: { measuregrps: [
  { date: Math.floor(Date.now()/1000), measures: [{ value: 750, unit: -1, type: 1 }, { value: 215, unit: -1, type: 6 }] },
]}});

const ACTIVITY_RESPONSE = JSON.stringify({ status: 0, body: { activities: [
  { date: "2026-05-02", steps: 8500, distance: 6200, totalcalories: 420 },
]}});

describe("plugin entry", () => {
  it("has correct id and name", async () => { const { entry } = await loadPlugin(); expect(entry.id).toBe("withings"); });
  it("registers all 7 tools", async () => {
    const { api } = await loadPlugin();
    expect(Object.keys(api.tools).sort()).toEqual(["withings_auth_complete","withings_auth_status","withings_auth_url","withings_get_activity","withings_get_heart","withings_get_measurements","withings_get_sleep"]);
  });
});

describe("withings_auth_url", () => {
  it("returns error when clientId missing", async () => {
    const { api } = await loadPlugin({ clientId: "" });
    const data = resultText(await api.tools["withings_auth_url"].execute("id", {}));
    expect(data).toHaveProperty("error");
  });

  it("returns auth URL with state", async () => {
    const { api } = await loadPlugin({ clientId: "my-client", clientSecret: "secret" });
    const data = resultText(await api.tools["withings_auth_url"].execute("id", {})) as Record<string,unknown>;
    expect(data.url).toContain("account.withings.com");
    expect(data.state).toBeDefined();
  });
});

describe("withings_auth_status", () => {
  it("returns not linked when no tokens", async () => {
    vi.spyOn(fs, "readFileSync").mockImplementation((p, ...args) => {
      if (String(p) === TOKEN_FILE) throw new Error("ENOENT");
      return (fs.readFileSync as (p: unknown, ...a: unknown[]) => string)(p, ...args);
    });
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["withings_auth_status"].execute("id", {})) as Record<string,unknown>;
    expect(data.linked).toBe(false);
  });

  it("returns linked when tokens exist", async () => {
    vi.spyOn(fs, "readFileSync").mockImplementation((p, ...args) => {
      if (String(p) === TOKEN_FILE) return FAKE_TOKENS;
      return (fs.readFileSync as (p: unknown, ...a: unknown[]) => string)(p, ...args);
    });
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["withings_auth_status"].execute("id", {})) as Record<string,unknown>;
    expect(data.linked).toBe(true);
    expect(data.userid).toBe("12345");
    expect(data.needs_refresh).toBe(false);
  });
});

describe("withings_get_measurements", () => {
  it("returns parsed measurements", async () => {
    vi.spyOn(fs, "readFileSync").mockImplementation((p, ...args) => {
      if (String(p) === TOKEN_FILE) return FAKE_TOKENS;
      return (fs.readFileSync as (p: unknown, ...a: unknown[]) => string)(p, ...args);
    });
    mockHttpsSeq([MEAS_RESPONSE, 200]);
    const { api } = await loadPlugin({ clientId: "cid", clientSecret: "csec" });
    const data = resultText(await api.tools["withings_get_measurements"].execute("id", { days_back: 7 })) as { count: number; measurements: Array<{ measures: Array<{ type: string; value: number }> }> };
    expect(data.count).toBe(1);
    expect(data.measurements[0].measures.find(m => m.type === "Weight (kg)")?.value).toBe(75);
  });
});

describe("withings_get_activity", () => {
  it("returns activity data", async () => {
    vi.spyOn(fs, "readFileSync").mockImplementation((p, ...args) => {
      if (String(p) === TOKEN_FILE) return FAKE_TOKENS;
      return (fs.readFileSync as (p: unknown, ...a: unknown[]) => string)(p, ...args);
    });
    mockHttpsSeq([ACTIVITY_RESPONSE, 200]);
    const { api } = await loadPlugin({ clientId: "cid", clientSecret: "csec" });
    const data = resultText(await api.tools["withings_get_activity"].execute("id", { days_back: 7 })) as { count: number; activities: Array<Record<string,unknown>> };
    expect(data.count).toBe(1);
    expect(data.activities[0].steps).toBe(8500);
  });
});
