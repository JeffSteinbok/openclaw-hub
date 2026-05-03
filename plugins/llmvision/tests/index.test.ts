import { describe, it, expect, vi, afterEach } from "vitest";
import http from "node:http";
import { EventEmitter } from "node:events";

afterEach(() => vi.restoreAllMocks());

function mockHttp(body: string, statusCode = 200) {
  const res = new EventEmitter() as NodeJS.EventEmitter & { statusCode: number; headers: Record<string,string> };
  res.statusCode = statusCode; res.headers = {};
  const req = new EventEmitter() as NodeJS.EventEmitter & { destroy:()=>void; end:()=>void; write:()=>void };
  req.destroy = vi.fn(); req.end = vi.fn(); req.write = vi.fn();
  vi.spyOn(http, "request").mockImplementationOnce((_url, _opts, cb) => {
    if (cb) cb(res as Parameters<typeof cb>[0]);
    setTimeout(() => { res.emit("data", Buffer.from(body)); res.emit("end"); }, 0);
    return req as unknown as ReturnType<typeof http.request>;
  });
}

interface ToolDef { name: string; description: string; execute: (id: string, params: Record<string,unknown>) => Promise<unknown> }
function makeApi(config: Record<string,unknown> = {}) {
  const tools: Record<string,ToolDef> = {};
  return { pluginConfig: { server:"http://ha.local:8123", token:"test", ...config }, registerTool(t: unknown) { tools[(t as ToolDef).name] = t as ToolDef; }, tools };
}
function resultText(r: unknown) { return JSON.parse((r as { content: Array<{text:string}> }).content[0].text); }

async function loadPlugin(config: Record<string,unknown> = {}) {
  const { createEntry } = await import("../src/index.js");
  const entry = createEntry();
  const api = makeApi(config);
  entry.register(api);
  return { entry, api };
}

describe("plugin entry", () => {
  it("has correct id and name", async () => {
    const { entry } = await loadPlugin();
    expect(entry.id).toBe("llmvision");
    expect(entry.name).toContain("LLM Vision");
  });

  it("registers all 4 tools", async () => {
    const { api } = await loadPlugin();
    expect(Object.keys(api.tools).sort()).toEqual(["llmvision_analyze_image","llmvision_create_event","llmvision_get_image","llmvision_timeline_get"]);
  });
});

describe("llmvision_timeline_get", () => {
  it("returns filtered events", async () => {
    const response = { events: [
      { title:"Motion", description:"Person detected", uid:"a1", start: new Date().toISOString(), end: new Date().toISOString(), camera_name:"front", key_frame:"/media/x.jpg" },
      { title:"Old", description:"Old event", uid:"a2", start:"2020-01-01T00:00:00Z", end:"2020-01-01T00:00:01Z", camera_name:"back", key_frame:"" },
    ]};
    mockHttp(JSON.stringify(response));
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["llmvision_timeline_get"].execute("id", { days: 1, limit: 10 })) as { count: number; events: unknown[] };
    expect(data.count).toBe(1);
    expect((data.events[0] as Record<string,unknown>).title).toBe("Motion");
  });

  it("surfaces HA errors", async () => {
    mockHttp("Unauthorized", 401);
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["llmvision_timeline_get"].execute("id", {}));
    expect(data).toHaveProperty("error");
  });
});

describe("llmvision_analyze_image", () => {
  it("returns error when required fields missing", async () => {
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["llmvision_analyze_image"].execute("id", { message: "What?", provider: "openai" }));
    expect(data).toMatchObject({ error: expect.stringContaining("camera_entity") });
  });

  it("calls HA service and returns result", async () => {
    mockHttp(JSON.stringify([{ context: {} }]));
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["llmvision_analyze_image"].execute("id", { camera_entity: "camera.front", message: "Describe", provider: "openai" })) as { result: unknown };
    expect(data).toHaveProperty("result");
  });
});

describe("llmvision_create_event", () => {
  it("returns error when title missing", async () => {
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["llmvision_create_event"].execute("id", { description: "d" }));
    expect(data).toMatchObject({ error: expect.stringContaining("title") });
  });

  it("returns error for invalid label", async () => {
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["llmvision_create_event"].execute("id", { title: "t", description: "d", label: "Invalid" }));
    expect(data).toMatchObject({ error: expect.stringContaining("Invalid") });
  });

  it("creates event with valid params", async () => {
    mockHttp(JSON.stringify([{}]));
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["llmvision_create_event"].execute("id", { title: "Motion", description: "Person at door", label: "Person" }));
    expect(data).toHaveProperty("result");
  });
});
