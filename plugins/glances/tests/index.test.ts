/**
 * Tests for the Glances plugin native TS implementation.
 *
 * Mocks Node's http.get to avoid real network calls.
 * Covers: tool registration, parameter validation, response shaping, and error handling.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import http from "node:http";
import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// HTTP mock helpers
// ---------------------------------------------------------------------------

function makeMockGet(body: string, statusCode = 200) {
  const res = new EventEmitter() as NodeJS.EventEmitter & { statusCode: number };
  res.statusCode = statusCode;
  const req = new EventEmitter() as NodeJS.EventEmitter & { destroy: () => void };
  req.destroy = vi.fn();

  const flush = () => {
    res.emit("data", Buffer.from(body));
    res.emit("end");
  };
  return { res, req, flush };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tool registration harness
// ---------------------------------------------------------------------------

interface ToolDef {
  name: string;
  description: string;
  parameters: unknown;
  execute: (id: string, params: Record<string, unknown>) => Promise<unknown>;
}

function makeApi(config: Record<string, unknown> = {}) {
  const tools: Record<string, ToolDef> = {};
  return {
    pluginConfig: config,
    registerTool(tool: unknown) {
      const t = tool as ToolDef;
      tools[t.name] = t;
    },
    tools,
  };
}

async function loadPlugin(config: Record<string, unknown> = {}) {
  const { createEntry } = await import("../src/index.js");
  const entry = createEntry();
  const api = makeApi({ ...config });
  entry.register(api);
  return { entry, api };
}

function resultText(result: unknown): unknown {
  const text = (result as { content: Array<{ text: string }> }).content[0].text;
  return JSON.parse(text);
}

function mockHttpGet(body: string, statusCode = 200) {
  const mock = makeMockGet(body, statusCode);
  vi.spyOn(http, "get").mockImplementationOnce((_url, _opts, cb) => {
    if (cb) cb(mock.res as Parameters<typeof cb>[0]);
    setTimeout(mock.flush, 0);
    return mock.req as unknown as ReturnType<typeof http.get>;
  });
  return mock;
}

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

describe("plugin entry", () => {
  it("has correct id and name", async () => {
    const { entry } = await loadPlugin();
    expect(entry.id).toBe("glances");
    expect(entry.name).toBe("Glances");
  });

  it("registers all expected tools", async () => {
    const { api } = await loadPlugin();
    const names = Object.keys(api.tools).sort();
    expect(names).toEqual([
      "glances_cpu_get",
      "glances_disk_get",
      "glances_endpoint_get",
      "glances_memory_get",
      "glances_summary_get",
    ]);
  });

  it("all tools have name, description, and parameters", async () => {
    const { api } = await loadPlugin();
    for (const tool of Object.values(api.tools)) {
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.parameters).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// glances_endpoint_get — validation
// ---------------------------------------------------------------------------

describe("glances_endpoint_get", () => {
  it("returns error when path is missing", async () => {
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["glances_endpoint_get"].execute("id", {}));
    expect(data).toMatchObject({ error: expect.stringContaining("path") });
  });

  it("returns error when path does not start with /api/3/", async () => {
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["glances_endpoint_get"].execute("id", { path: "/api/2/cpu" }));
    expect(data).toMatchObject({ error: expect.stringContaining("/api/3/") });
  });

  it("calls the correct URL for a valid path", async () => {
    const { api } = await loadPlugin({ url: "http://localhost:61208" });
    let capturedUrl = "";
    const mock = makeMockGet(JSON.stringify({ foo: "bar" }));
    vi.spyOn(http, "get").mockImplementationOnce((url, _opts, cb) => {
      capturedUrl = url as string;
      if (cb) cb(mock.res as Parameters<typeof cb>[0]);
      setTimeout(mock.flush, 0);
      return mock.req as unknown as ReturnType<typeof http.get>;
    });

    await api.tools["glances_endpoint_get"].execute("id", { path: "/api/3/uptime" });
    expect(capturedUrl).toBe("http://localhost:61208/api/3/uptime");
  });
});

// ---------------------------------------------------------------------------
// glances_disk_get
// ---------------------------------------------------------------------------

describe("glances_disk_get", () => {
  it("returns error when mount_point not found", async () => {
    const { api } = await loadPlugin();
    mockHttpGet(JSON.stringify([{ mnt_point: "/", percent: 10, used: 0, free: 0, size: 0 }]));

    const data = resultText(await api.tools["glances_disk_get"].execute("id", { mount_point: "/nonexistent" }));
    expect(data).toMatchObject({ error: expect.stringContaining("/nonexistent") });
  });

  it("shapes disk response with GiB conversions", async () => {
    const { api } = await loadPlugin();
    mockHttpGet(JSON.stringify([{
      mnt_point: "/",
      device_name: "/dev/sda1",
      fs_type: "ext4",
      percent: 42,
      used: 1073741824,  // 1 GiB
      free: 2147483648,  // 2 GiB
      size: 3221225472,  // 3 GiB
    }]));

    const data = resultText(await api.tools["glances_disk_get"].execute("id", { mount_point: "/" })) as { output: Record<string, unknown> };
    expect(data.output.used_gib).toBe(1);
    expect(data.output.free_gib).toBe(2);
    expect(data.output.size_gib).toBe(3);
    expect(data.output.percent_used).toBe(42);
    expect(data.output.mount_point).toBe("/");
  });
});

// ---------------------------------------------------------------------------
// glances_memory_get
// ---------------------------------------------------------------------------

describe("glances_memory_get", () => {
  it("shapes memory response with GiB conversions", async () => {
    const { api } = await loadPlugin();
    mockHttpGet(JSON.stringify({
      percent: 55.5,
      used: 2147483648,   // 2 GiB
      available: 1073741824, // 1 GiB
      free: 1073741824,   // 1 GiB
      total: 4294967296,  // 4 GiB
    }));

    const data = resultText(await api.tools["glances_memory_get"].execute("id", {})) as { output: Record<string, unknown> };
    expect(data.output.percent_used).toBe(55.5);
    expect(data.output.total_gib).toBe(4);
    expect(data.output.used_gib).toBe(2);
    expect(data.output.available_gib).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// glances_cpu_get
// ---------------------------------------------------------------------------

describe("glances_cpu_get", () => {
  it("returns cpu data without percpu by default", async () => {
    const { api } = await loadPlugin();
    mockHttpGet(JSON.stringify({ total: 22.5, user: 15.0, system: 7.5 }));

    const data = resultText(await api.tools["glances_cpu_get"].execute("id", {})) as { output: Record<string, unknown> };
    expect(data.output.total).toBe(22.5);
    expect(data.output.percpu).toBeUndefined();
  });

  it("includes percpu when include_percpu is true", async () => {
    const { api } = await loadPlugin();
    // First call: /api/3/cpu, second call: /api/3/quicklook
    vi.spyOn(http, "get")
      .mockImplementationOnce((_url, _opts, cb) => {
        const mock = makeMockGet(JSON.stringify({ total: 22.5 }));
        if (cb) cb(mock.res as Parameters<typeof cb>[0]);
        setTimeout(mock.flush, 0);
        return mock.req as unknown as ReturnType<typeof http.get>;
      })
      .mockImplementationOnce((_url, _opts, cb) => {
        const mock = makeMockGet(JSON.stringify({ percpu: [10, 20, 15, 25] }));
        if (cb) cb(mock.res as Parameters<typeof cb>[0]);
        setTimeout(mock.flush, 0);
        return mock.req as unknown as ReturnType<typeof http.get>;
      });

    const data = resultText(await api.tools["glances_cpu_get"].execute("id", { include_percpu: true })) as { output: Record<string, unknown> };
    expect(data.output.percpu).toEqual([10, 20, 15, 25]);
  });
});

// ---------------------------------------------------------------------------
// HTTP error propagation
// ---------------------------------------------------------------------------

describe("HTTP error propagation", () => {
  it("surfaces HTTP 500 as error", async () => {
    const { api } = await loadPlugin();
    mockHttpGet("Internal error", 500);

    const data = resultText(await api.tools["glances_memory_get"].execute("id", {}));
    expect(data).toHaveProperty("error");
  });

  it("surfaces network error (ECONNREFUSED)", async () => {
    const { api } = await loadPlugin();
    const { req } = makeMockGet("");
    vi.spyOn(http, "get").mockImplementationOnce((_url, _opts, _cb) => {
      setTimeout(() => req.emit("error", new Error("ECONNREFUSED")), 0);
      return req as unknown as ReturnType<typeof http.get>;
    });

    const data = resultText(await api.tools["glances_memory_get"].execute("id", {}));
    expect(data).toMatchObject({ error: expect.stringContaining("ECONNREFUSED") });
  });
});
