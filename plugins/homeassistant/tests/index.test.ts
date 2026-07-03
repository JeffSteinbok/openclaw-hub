/**
 * Tests for the Home Assistant plugin native TS implementation.
 *
 * Mocks Node's http module to avoid real network calls.
 * Covers: tool registration, parameter validation, entity shaping,
 * service calls, logbook filtering, camera listing, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import http from "node:http";
import { EventEmitter } from "node:events";

beforeEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// HTTP mock helpers
// ---------------------------------------------------------------------------

function makeMockHttpRequest(body: string, statusCode = 200) {
  const res = new EventEmitter() as NodeJS.EventEmitter & { statusCode: number };
  res.statusCode = statusCode;
  const req = new EventEmitter() as NodeJS.EventEmitter & {
    destroy: () => void;
    end: () => void;
    write: () => void;
  };
  req.destroy = vi.fn();
  req.end = vi.fn();
  req.write = vi.fn();

  const flush = () => {
    res.emit("data", Buffer.from(body));
    res.emit("end");
  };

  return { res, req, flush };
}

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

function mockHttp(body: string, statusCode = 200) {
  const mock = makeMockHttpRequest(body, statusCode);
  vi.spyOn(http, "request").mockImplementationOnce((_url, _opts, cb) => {
    if (cb) cb(mock.res as Parameters<typeof cb>[0]);
    setTimeout(mock.flush, 0);
    return mock.req as unknown as ReturnType<typeof http.request>;
  });
  return mock;
}

function mockHttpSequence(steps: Array<{
  body: string;
  statusCode?: number;
  inspect?: (request: { url: string; method: string; body: string }) => void;
}>) {
  vi.spyOn(http, "request").mockImplementation((url, opts, cb) => {
    const step = steps.shift();
    if (!step) throw new Error("Unexpected HTTP request");

    const mock = makeMockHttpRequest(step.body, step.statusCode ?? 200);
    let requestBody = "";
    mock.req.write = vi.fn((chunk?: string | Buffer) => {
      if (typeof chunk === "string") requestBody += chunk;
      else if (chunk) requestBody += chunk.toString("utf8");
    });

    if (cb) cb(mock.res as Parameters<typeof cb>[0]);
    setTimeout(() => {
      step.inspect?.({
        url: String(url),
        method: typeof opts === "object" && opts && "method" in opts ? String((opts as { method?: string }).method ?? "") : "",
        body: requestBody,
      });
      mock.flush();
    }, 0);
    return mock.req as unknown as ReturnType<typeof http.request>;
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ENTITY_SUN = {
  entity_id: "sun.sun",
  state: "above_horizon",
  attributes: { friendly_name: "Sun", elevation: 45 },
  context: { id: "ctx-1" },
  last_changed: "2026-05-01T12:00:00Z",
};

const ENTITY_LIGHT = {
  entity_id: "light.living_room",
  state: "on",
  attributes: { friendly_name: "Living Room", brightness: 200 },
  context: { id: "ctx-2" },
};

const ENTITY_PERSON = {
  entity_id: "person.jeff",
  state: "home",
  attributes: { friendly_name: "Jeff" },
  context: { id: "ctx-3" },
};

const ENTITY_SPEAKER = {
  entity_id: "media_player.kitchen",
  state: "playing",
  attributes: {
    friendly_name: "Kitchen Speaker",
    volume_level: 0.5,
    is_volume_muted: false,
  },
  context: { id: "ctx-4" },
};

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

describe("plugin entry", () => {
  it("has correct id and name", async () => {
    const { entry } = await loadPlugin();
    expect(entry.id).toBe("homeassistant");
    expect(entry.name).toBe("Home Assistant");
  });

  it("registers all expected tools", async () => {
    const { api } = await loadPlugin();
    const names = Object.keys(api.tools).sort();
    expect(names).toEqual([
      "hass_camera_collage",
      "hass_camera_list",
      "hass_camera_snapshot",
      "hass_event_list",
      "hass_logbook",
      "hass_lovelace_get",
      "hass_lovelace_set",
      "hass_person_find",
      "hass_service_call",
      "hass_speaker_volume_get",
      "hass_speaker_volume_set",
      "hass_state_get",
      "hass_state_list",
    ]);
  });

  it("all tools have name, description, and parameters", async () => {
    const { api } = await loadPlugin();
    for (const tool of Object.values(api.tools)) {
      expect(typeof tool.name).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.parameters).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// hass_state_get
// ---------------------------------------------------------------------------

describe("hass_state_get", () => {
  it("returns error when entity_id is missing", async () => {
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["hass_state_get"].execute("id", {}));
    expect(data).toMatchObject({ error: expect.stringContaining("entity_id") });
  });

  it("strips context from response", async () => {
    const { api } = await loadPlugin();
    mockHttp(JSON.stringify(ENTITY_SUN));

    const data = resultText(await api.tools["hass_state_get"].execute("id", { entity_id: "sun.sun" })) as { output: Record<string, unknown> };
    expect(data.output.entity_id).toBe("sun.sun");
    expect(data.output.context).toBeUndefined();
    expect(data.output.state).toBe("above_horizon");
  });

  it("surfaces HTTP errors", async () => {
    const { api } = await loadPlugin();
    mockHttp("Not found", 404);

    const data = resultText(await api.tools["hass_state_get"].execute("id", { entity_id: "sensor.missing" }));
    expect(data).toHaveProperty("error");
  });
});

// ---------------------------------------------------------------------------
// hass_state_list
// ---------------------------------------------------------------------------

describe("hass_state_list", () => {
  it("returns all entities without domain filter", async () => {
    const { api } = await loadPlugin();
    mockHttp(JSON.stringify([ENTITY_SUN, ENTITY_LIGHT, ENTITY_PERSON]));

    const data = resultText(await api.tools["hass_state_list"].execute("id", {})) as { output: unknown[]; count: number };
    expect(data.count).toBe(3);
    expect(Array.isArray(data.output)).toBe(true);
  });

  it("filters by domain", async () => {
    const { api } = await loadPlugin();
    mockHttp(JSON.stringify([ENTITY_SUN, ENTITY_LIGHT, ENTITY_PERSON]));

    const data = resultText(await api.tools["hass_state_list"].execute("id", { domain: "light" })) as { output: Array<{ entity_id: string }>; count: number };
    expect(data.count).toBe(1);
    expect(data.output[0].entity_id).toBe("light.living_room");
  });

  it("uses compact mode for domain filter with many results", async () => {
    const { api } = await loadPlugin();
    // Generate 101 light entities to trigger compact mode
    const entities = Array.from({ length: 101 }, (_, i) => ({
      entity_id: `light.room_${i}`,
      state: "on",
      attributes: { friendly_name: `Room ${i}` },
    }));
    mockHttp(JSON.stringify(entities));

    const data = resultText(await api.tools["hass_state_list"].execute("id", { domain: "light" })) as { output: Array<Record<string, unknown>> };
    // Compact mode: only entity_id, state, friendly_name
    const keys = Object.keys(data.output[0]);
    expect(keys).toContain("entity_id");
    expect(keys).toContain("state");
    expect(keys).not.toContain("last_changed");
  });
});

// ---------------------------------------------------------------------------
// hass_service_call
// ---------------------------------------------------------------------------

describe("hass_service_call", () => {
  it("returns error when domain is missing", async () => {
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["hass_service_call"].execute("id", { service: "turn_on" }));
    expect(data).toMatchObject({ error: expect.stringContaining("domain") });
  });

  it("returns error when service is missing", async () => {
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["hass_service_call"].execute("id", { domain: "light" }));
    expect(data).toMatchObject({ error: expect.stringContaining("service") });
  });

  it("calls correct HA service endpoint", async () => {
    const { api } = await loadPlugin();
    let capturedUrl = "";
    const mock = makeMockHttpRequest(JSON.stringify([]));
    vi.spyOn(http, "request").mockImplementationOnce((url, _opts, cb) => {
      capturedUrl = url as string;
      if (cb) cb(mock.res as Parameters<typeof cb>[0]);
      setTimeout(mock.flush, 0);
      return mock.req as unknown as ReturnType<typeof http.request>;
    });

    await api.tools["hass_service_call"].execute("id", {
      domain: "light",
      service: "turn_on",
      entity_id: "light.living_room",
    });
    expect(capturedUrl).toContain("/api/services/light/turn_on");
  });
});

// ---------------------------------------------------------------------------
// hass_lovelace_get
// ---------------------------------------------------------------------------

describe("hass_lovelace_get", () => {
  it("reads the default Lovelace config", async () => {
    const { api } = await loadPlugin();
    let capturedUrl = "";
    const mock = makeMockHttpRequest(JSON.stringify({ title: "Home", views: [] }));
    vi.spyOn(http, "request").mockImplementationOnce((url, _opts, cb) => {
      capturedUrl = url as string;
      if (cb) cb(mock.res as Parameters<typeof cb>[0]);
      setTimeout(mock.flush, 0);
      return mock.req as unknown as ReturnType<typeof http.request>;
    });

    const data = resultText(await api.tools["hass_lovelace_get"].execute("id", {})) as { output: Record<string, unknown> };
    expect(capturedUrl).toContain("/api/lovelace/config");
    expect(data.output.title).toBe("Home");
  });

  it("resolves dashboard title and returns a matching view", async () => {
    const { api } = await loadPlugin();
    const seenUrls: string[] = [];
    mockHttpSequence([
      {
        body: JSON.stringify([{ url_path: "system", title: "System" }]),
        inspect: ({ url }) => { seenUrls.push(url); },
      },
      {
        body: JSON.stringify({
          title: "System",
          views: [
            { title: "Matter", path: "matter", cards: [{ type: "entities" }] },
            { title: "Other", path: "other", cards: [] },
          ],
        }),
        inspect: ({ url }) => { seenUrls.push(url); },
      },
    ]);

    const data = resultText(await api.tools["hass_lovelace_get"].execute("id", {
      dashboard: "System",
      view: "Matter",
    })) as { dashboard: string; view: string; output: Record<string, unknown> };

    expect(seenUrls[0]).toContain("/api/lovelace/dashboards");
    expect(seenUrls[1]).toContain("/api/lovelace/system/config");
    expect(data.dashboard).toBe("system");
    expect(data.view).toBe("Matter");
    expect(data.output.path).toBe("matter");
  });
});

// ---------------------------------------------------------------------------
// hass_lovelace_set
// ---------------------------------------------------------------------------

describe("hass_lovelace_set", () => {
  it("returns error when config is missing", async () => {
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["hass_lovelace_set"].execute("id", {}));
    expect(data).toMatchObject({ error: expect.stringContaining("config") });
  });

  it("writes the default Lovelace config with PUT", async () => {
    const { api } = await loadPlugin();
    const seen: Array<{ url: string; method: string; body: string }> = [];
    mockHttpSequence([
      {
        body: JSON.stringify({ status: "ok" }),
        inspect: (request) => { seen.push(request); },
      },
    ]);

    const payload = { title: "Home", views: [{ title: "Matter", path: "matter" }] };
    const data = resultText(await api.tools["hass_lovelace_set"].execute("id", {
      config: payload,
    })) as { output: Record<string, unknown> };

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toContain("/api/lovelace/config");
    expect(seen[0].method).toBe("PUT");
    expect(JSON.parse(seen[0].body)).toEqual(payload);
    expect(data.output.status).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// hass_person_find
// ---------------------------------------------------------------------------

describe("hass_person_find", () => {
  it("returns error when neither name nor entity_id is provided", async () => {
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["hass_person_find"].execute("id", {}));
    expect(data).toMatchObject({ error: expect.stringContaining("required") });
  });

  it("finds person by name substring match", async () => {
    const { api } = await loadPlugin();
    mockHttp(JSON.stringify([ENTITY_SUN, ENTITY_LIGHT, ENTITY_PERSON]));

    const data = resultText(await api.tools["hass_person_find"].execute("id", { name: "jeff" })) as { output: Array<{ entity_id: string }>; count: number };
    expect(data.count).toBe(1);
    expect(data.output[0].entity_id).toBe("person.jeff");
  });

  it("returns empty when name not found", async () => {
    const { api } = await loadPlugin();
    mockHttp(JSON.stringify([ENTITY_SUN, ENTITY_LIGHT]));

    const data = resultText(await api.tools["hass_person_find"].execute("id", { name: "nobody" })) as { count: number };
    expect(data.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// hass_speaker_volume_get
// ---------------------------------------------------------------------------

describe("hass_speaker_volume_get", () => {
  it("returns single speaker by entity_id", async () => {
    const { api } = await loadPlugin();
    mockHttp(JSON.stringify(ENTITY_SPEAKER));

    const data = resultText(await api.tools["hass_speaker_volume_get"].execute("id", { entity_id: "media_player.kitchen" })) as { output: Record<string, unknown> };
    expect(data.output.entity_id).toBe("media_player.kitchen");
    expect(data.output.volume_level).toBe(0.5);
  });

  it("lists all speakers when no entity_id given", async () => {
    const { api } = await loadPlugin();
    mockHttp(JSON.stringify([ENTITY_SUN, ENTITY_SPEAKER]));

    const data = resultText(await api.tools["hass_speaker_volume_get"].execute("id", {})) as { count: number; output: unknown[] };
    expect(data.count).toBe(1);
    expect(Array.isArray(data.output)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hass_speaker_volume_set
// ---------------------------------------------------------------------------

describe("hass_speaker_volume_set", () => {
  it("returns error when entity_id is missing", async () => {
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["hass_speaker_volume_set"].execute("id", { volume_level: 0.5 }));
    expect(data).toMatchObject({ error: expect.stringContaining("entity_id") });
  });

  it("returns error when volume_level is missing", async () => {
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["hass_speaker_volume_set"].execute("id", { entity_id: "media_player.kitchen" }));
    expect(data).toMatchObject({ error: expect.stringContaining("volume_level") });
  });

  it("returns error when volume_level > 1", async () => {
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["hass_speaker_volume_set"].execute("id", { entity_id: "media_player.kitchen", volume_level: 1.5 }));
    expect(data).toMatchObject({ error: expect.stringContaining("1.0") });
  });

  it("returns error when volume_level < 0", async () => {
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["hass_speaker_volume_set"].execute("id", { entity_id: "media_player.kitchen", volume_level: -0.1 }));
    expect(data).toMatchObject({ error: expect.stringContaining("0.0") });
  });

  it("calls volume_set service for valid input", async () => {
    const { api } = await loadPlugin();
    let capturedUrl = "";
    const mock = makeMockHttpRequest(JSON.stringify([]));
    vi.spyOn(http, "request").mockImplementationOnce((url, _opts, cb) => {
      capturedUrl = url as string;
      if (cb) cb(mock.res as Parameters<typeof cb>[0]);
      setTimeout(mock.flush, 0);
      return mock.req as unknown as ReturnType<typeof http.request>;
    });

    await api.tools["hass_speaker_volume_set"].execute("id", {
      entity_id: "media_player.kitchen",
      volume_level: 0.7,
    });
    expect(capturedUrl).toContain("/api/services/media_player/volume_set");
  });
});

// ---------------------------------------------------------------------------
// hass_logbook
// ---------------------------------------------------------------------------

describe("hass_logbook", () => {
  const LOG_ENTRIES = [
    { when: "2026-05-01T10:00:00Z", entity_id: "light.living_room", name: "Living Room", state: "on", message: null, domain: "light" },
    { when: "2026-05-01T10:01:00Z", entity_id: "sensor.temp", name: "Temperature", state: "22", message: "changed", domain: "sensor" },
  ];

  it("returns logbook entries", async () => {
    const { api } = await loadPlugin();
    mockHttp(JSON.stringify(LOG_ENTRIES));

    const data = resultText(await api.tools["hass_logbook"].execute("id", {})) as { count: number; entries: unknown[] };
    expect(data.count).toBe(2);
    expect(data.entries).toHaveLength(2);
  });

  it("filters by keyword", async () => {
    const { api } = await loadPlugin();
    mockHttp(JSON.stringify(LOG_ENTRIES));

    const data = resultText(await api.tools["hass_logbook"].execute("id", { keyword: "living" })) as { count: number };
    expect(data.count).toBe(1);
  });

  it("respects limit", async () => {
    const { api } = await loadPlugin();
    mockHttp(JSON.stringify(LOG_ENTRIES));

    const data = resultText(await api.tools["hass_logbook"].execute("id", { limit: 1 })) as { count: number; entries: unknown[] };
    expect(data.count).toBe(1);
    expect(data.entries).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// hass_camera_list
// ---------------------------------------------------------------------------

describe("hass_camera_list", () => {
  it("returns all known cameras", async () => {
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["hass_camera_list"].execute("id", {})) as { cameras: Array<{ name: string; entity_id: string }> };
    expect(Array.isArray(data.cameras)).toBe(true);
    const names = data.cameras.map((c) => c.name);
    expect(names).toContain("front-doorbell");
    expect(names).toContain("driveway");
    expect(names).toContain("garage");
    for (const cam of data.cameras) {
      expect(typeof cam.entity_id).toBe("string");
      expect(cam.entity_id.startsWith("camera.")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// hass_camera_snapshot — unknown camera
// ---------------------------------------------------------------------------

describe("hass_camera_snapshot", () => {
  it("returns error for unknown camera name", async () => {
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["hass_camera_snapshot"].execute("id", { camera_name: "nonexistent" }));
    expect(data).toMatchObject({ error: expect.stringContaining("Unknown camera") });
  });

  it("returns error when camera_name is missing", async () => {
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["hass_camera_snapshot"].execute("id", {}));
    expect(data).toMatchObject({ error: expect.stringContaining("camera_name") });
  });
});

// ---------------------------------------------------------------------------
// HTTP error propagation
// ---------------------------------------------------------------------------

describe("HTTP error propagation", () => {
  it("surfaces network errors for state_get", async () => {
    const { api } = await loadPlugin();
    const { req } = makeMockHttpRequest("");
    vi.spyOn(http, "request").mockImplementationOnce((_url, _opts, _cb) => {
      setTimeout(() => req.emit("error", new Error("ECONNREFUSED")), 0);
      return req as unknown as ReturnType<typeof http.request>;
    });

    const data = resultText(await api.tools["hass_state_get"].execute("id", { entity_id: "sun.sun" }));
    expect(data).toMatchObject({ error: expect.stringContaining("ECONNREFUSED") });
  });

  it("surfaces HTTP 401 Unauthorized", async () => {
    const { api } = await loadPlugin();
    mockHttp("Unauthorized", 401);

    const data = resultText(await api.tools["hass_state_get"].execute("id", { entity_id: "sun.sun" }));
    expect(data).toHaveProperty("error");
    expect((data as { error: string }).error).toContain("401");
  });
});
