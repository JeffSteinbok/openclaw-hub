/**
 * Tests for the WeightWatchers plugin native TS implementation.
 *
 * Mocks http/https to avoid real API calls. No WW credentials needed.
 * Covers: tool registration, SmartPoints formula, parameter validation,
 * response shaping, and error handling.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import https from "node:https";
import { EventEmitter } from "node:events";

afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// HTTP mock helpers
// ---------------------------------------------------------------------------

function makeMockRequest(body: string, statusCode = 200) {
  const res = new EventEmitter() as NodeJS.EventEmitter & { statusCode: number; headers: Record<string, string> };
  res.statusCode = statusCode;
  res.headers = {};
  const req = new EventEmitter() as NodeJS.EventEmitter & { destroy: () => void; end: () => void; write: () => void };
  req.destroy = vi.fn();
  req.end = vi.fn();
  req.write = vi.fn();
  const flush = () => { res.emit("data", Buffer.from(body)); res.emit("end"); };
  return { res, req, flush };
}

function mockHttps(body: string, statusCode = 200) {
  const mock = makeMockRequest(body, statusCode);
  vi.spyOn(https, "request").mockImplementationOnce((_url, _opts, cb) => {
    if (cb) cb(mock.res as Parameters<typeof cb>[0]);
    setTimeout(mock.flush, 0);
    return mock.req as unknown as ReturnType<typeof https.request>;
  });
  return mock;
}

// ---------------------------------------------------------------------------
// Tool harness
// ---------------------------------------------------------------------------

interface ToolDef {
  name: string;
  description: string;
  execute: (id: string, params: Record<string, unknown>) => Promise<unknown>;
}

function makeApi(config: Record<string, unknown> = {}) {
  const tools: Record<string, ToolDef> = {};
  return {
    pluginConfig: { jwt: "test-jwt-token", tld: "com", ...config },
    registerTool(tool: unknown) { const t = tool as ToolDef; tools[t.name] = t; },
    tools,
  };
}

async function loadPlugin(config: Record<string, unknown> = {}) {
  const { createEntry } = await import("../src/index.js");
  const entry = createEntry();
  const api = makeApi(config);
  entry.register(api);
  return { entry, api };
}

function resultText(result: unknown): unknown {
  const text = (result as { content: Array<{ text: string }> }).content[0].text;
  return JSON.parse(text);
}

const MY_DAY_RESPONSE = JSON.stringify({
  today: {
    trackedFoods: {
      morning: [{ _id: "track1", name: "Oatmeal", smartPoints: 4, portionSize: 1, portionName: "cup" }],
      anytime: [{ _id: "track2", name: "Apple", smartPoints: 0, portionSize: 1, portionName: "medium" }],
    },
    pointsDetails: {
      dailyPointTarget: 23,
      dailyPointsUsed: 4,
      dailyPointsRemaining: 19,
      weeklyPointAllowance: 49,
      weeklyPointAllowanceUsed: 4,
    },
  },
});

const SEARCH_RESPONSE = JSON.stringify({
  hits: [
    {
      _id: "food123",
      versionId: "v1",
      name: "Grilled Chicken Breast",
      smartPoints: 3,
      isZeroPoints: false,
      sourceType: "WWFOOD",
      portions: [{ _id: "p1", size: "3", name: "oz" }],
    },
    {
      _id: "food456",
      versionId: "v2",
      name: "Broccoli",
      smartPoints: 0,
      isZeroPoints: true,
      sourceType: "WWFOOD",
      portions: [{ _id: "p2", size: "1", name: "cup" }],
    },
  ],
});

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

describe("plugin entry", () => {
  it("has correct id and name", async () => {
    const { entry } = await loadPlugin();
    expect(entry.id).toBe("weightwatchers");
    expect(entry.name).toBe("WeightWatchers");
  });

  it("registers all 9 tools", async () => {
    const { api } = await loadPlugin();
    const names = Object.keys(api.tools).sort();
    expect(names).toEqual(["ww_budget", "ww_daily", "ww_delete", "ww_log", "ww_log_meal", "ww_points", "ww_quick_add", "ww_search", "ww_search_meals"]);
  });

  it("all tools have name and description", async () => {
    const { api } = await loadPlugin();
    for (const tool of Object.values(api.tools)) {
      expect(typeof tool.name).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// ww_points — offline SmartPoints formula (no network needed)
// ---------------------------------------------------------------------------

describe("ww_points — SmartPoints formula", () => {
  it("calculates correctly for known values", async () => {
    const { api } = await loadPlugin();
    // 200 cal, 2g sat fat, 10g sugar, 15g protein
    // = 200*0.0305 + 2*0.275 + 10*0.12 - 15*0.098 = 6.1 + 0.55 + 1.2 - 1.47 = 6.38 → round = 6
    const data = resultText(await api.tools["ww_points"].execute("id", { calories: 200, saturated_fat: 2, sugar: 10, protein: 15 })) as { smart_points: number };
    expect(data.smart_points).toBe(6);
  });

  it("floors at 0 (no negative points)", async () => {
    const { api } = await loadPlugin();
    // Very high protein, low everything else
    const data = resultText(await api.tools["ww_points"].execute("id", { calories: 100, saturated_fat: 0, sugar: 0, protein: 50 })) as { smart_points: number };
    expect(data.smart_points).toBe(0);
  });

  it("returns inputs in response", async () => {
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["ww_points"].execute("id", { calories: 150, saturated_fat: 1, sugar: 5, protein: 10 })) as { inputs: Record<string, number> };
    expect(data.inputs.calories).toBe(150);
    expect(data.inputs.protein).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// ww_daily
// ---------------------------------------------------------------------------

describe("ww_daily", () => {
  it("returns meals and budget", async () => {
    const { api } = await loadPlugin();
    mockHttps(MY_DAY_RESPONSE);

    const data = resultText(await api.tools["ww_daily"].execute("id", { date: "2026-05-02" })) as {
      date: string;
      meals: Record<string, Array<{ name: string; points: number }>>;
      budget: { daily_target: number; remaining: number };
    };
    expect(data.date).toBe("2026-05-02");
    expect(data.meals["Breakfast"]).toHaveLength(1);
    expect(data.meals["Breakfast"][0].name).toBe("Oatmeal");
    expect(data.meals["Breakfast"][0].points).toBe(4);
    expect(data.budget.daily_target).toBe(23);
    expect(data.budget.remaining).toBe(19);
  });

  it("surfaces API errors", async () => {
    const { api } = await loadPlugin();
    mockHttps("Unauthorized", 401);
    mockHttps("Unauthorized", 401); // second attempt after reauth

    const data = resultText(await api.tools["ww_daily"].execute("id", {}));
    expect(data).toHaveProperty("error");
  });
});

// ---------------------------------------------------------------------------
// ww_budget
// ---------------------------------------------------------------------------

describe("ww_budget", () => {
  it("returns daily and weekly budget info", async () => {
    const { api } = await loadPlugin();
    mockHttps(MY_DAY_RESPONSE);

    const data = resultText(await api.tools["ww_budget"].execute("id", { date: "2026-05-02" })) as Record<string, unknown>;
    expect(data.daily_target).toBe(23);
    expect(data.used).toBe(4);
    expect(data.remaining).toBe(19);
    expect(data.weekly_allowance).toBe(49);
    expect(data.weekly_used).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// ww_search
// ---------------------------------------------------------------------------

describe("ww_search", () => {
  it("returns error when query is missing", async () => {
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["ww_search"].execute("id", {}));
    expect(data).toMatchObject({ error: expect.stringContaining("query") });
  });

  it("returns formatted food results", async () => {
    const { api } = await loadPlugin();
    mockHttps(SEARCH_RESPONSE);

    const data = resultText(await api.tools["ww_search"].execute("id", { query: "chicken" })) as { count: number; results: Array<Record<string, unknown>> };
    expect(data.count).toBe(2);
    expect(data.results[0].name).toBe("Grilled Chicken Breast");
    expect(data.results[0].food_id).toBe("food123");
    expect(data.results[0].points).toBe(3);
    expect(data.results[1].is_zero_points).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ww_log
// ---------------------------------------------------------------------------

describe("ww_log", () => {
  it("logs food and returns ok status", async () => {
    const { api } = await loadPlugin();
    mockHttps(JSON.stringify({ success: true }));

    const data = resultText(await api.tools["ww_log"].execute("id", {
      food_id: "food123",
      version_id: "v1",
      portion_id: "p1",
      meal_type: "breakfast",
      date: "2026-05-02",
    })) as { status: string; meal: string };
    expect(data.status).toBe("ok");
    expect(data.meal).toBe("breakfast");
  });
});

// ---------------------------------------------------------------------------
// ww_quick_add
// ---------------------------------------------------------------------------

describe("ww_quick_add", () => {
  it("quick-adds points and returns ok", async () => {
    const { api } = await loadPlugin();
    mockHttps(JSON.stringify({ success: true }));

    const data = resultText(await api.tools["ww_quick_add"].execute("id", { points: 5, meal_type: "snacks", date: "2026-05-02" })) as { status: string; points: number };
    expect(data.status).toBe("ok");
    expect(data.points).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// ww_delete
// ---------------------------------------------------------------------------

describe("ww_delete", () => {
  it("returns error when tracking_id is missing", async () => {
    const { api } = await loadPlugin();
    // tracking_id check happens before any HTTP call
    const data = resultText(await api.tools["ww_delete"].execute("id", {}));
    expect(data).toMatchObject({ error: expect.stringContaining("tracking_id") });
  });

  it("deletes entry and returns ok", async () => {
    const { api } = await loadPlugin();
    // Set up two sequential mocks on one spy: GET then DELETE
    const mock1 = makeMockRequest(JSON.stringify([{ _id: "track1", entryId: "entry-uuid-1", sourceType: "WWFOOD", timeOfDay: "morning" }]), 200);
    const mock2 = makeMockRequest("OK", 200);
    vi.spyOn(https, "request")
      .mockImplementationOnce((_url, _opts, cb) => { if (cb) cb(mock1.res as Parameters<typeof cb>[0]); setTimeout(mock1.flush, 0); return mock1.req as unknown as ReturnType<typeof https.request>; })
      .mockImplementationOnce((_url, _opts, cb) => { if (cb) cb(mock2.res as Parameters<typeof cb>[0]); setTimeout(mock2.flush, 0); return mock2.req as unknown as ReturnType<typeof https.request>; });

    const data = resultText(await api.tools["ww_delete"].execute("id", { tracking_id: "track1", date: "2026-05-02" })) as { status: string; tracking_id: string };
    expect(data.status).toBe("ok");
    expect(data.tracking_id).toBe("track1");
  });
});
