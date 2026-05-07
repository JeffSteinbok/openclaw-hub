import { describe, it, expect, vi, afterEach } from "vitest";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";

afterEach(() => vi.restoreAllMocks());

// LIFO: register in reverse order
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

// Write a fake token cache so getToken() doesn't try to refresh
const HOME = process.env.HOME ?? "/home/openclaw";
const TOKEN_CACHE = path.join(HOME, ".openclaw/.spotify_token_cache");
const FAKE_CACHE = JSON.stringify({ access_token: "test-access-token", expires_at: Date.now()/1000 + 3600 });

const NOW_PLAYING = JSON.stringify({ is_playing: true, item: { name: "Strobe", uri: "spotify:track:abc", type: "track", duration_ms: 400000,
  artists: [{ name: "deadmau5" }], album: { name: "For Lack of a Better Name" } }, progress_ms: 120000, device: { name: "Kitchen" } });

const SEARCH_RESULTS = JSON.stringify({ tracks: { items: [{ name: "Strobe", uri: "spotify:track:abc", artists: [{ name: "deadmau5" }], album: { name: "FLOBАН" } }] } });
const PLAYLISTS = JSON.stringify({ items: [{ id: "pl1", name: "Chill", uri: "spotify:playlist:pl1", tracks: { total: 42 } }] });
const DEVICES = JSON.stringify({ devices: [{ id: "dev1", name: "Kitchen Speaker", type: "Speaker", is_active: true }] });

describe("plugin entry", () => {
  it("has correct id and name", async () => { const { entry } = await loadPlugin(); expect(entry.id).toBe("spotify"); });
  it("registers all 9 tools", async () => {
    const { api } = await loadPlugin();
    expect(Object.keys(api.tools).sort()).toEqual(["spotify_add_to_playlist","spotify_get_devices","spotify_get_playlists","spotify_next","spotify_now_playing","spotify_pause","spotify_play","spotify_previous","spotify_search"]);
  });
});

describe("spotify_now_playing", () => {
  it("returns playing state from token cache", async () => {
    vi.spyOn(fs, "readFileSync").mockImplementation((p, ...args) => {
      if (String(p) === TOKEN_CACHE) return FAKE_CACHE;
      return (fs.readFileSync as (p: unknown, ...a: unknown[]) => string)(p, ...args);
    });
    mockHttpsSeq([NOW_PLAYING, 200]);
    const { api } = await loadPlugin({ clientId: "cid", clientSecret: "csec" });
    const data = resultText(await api.tools["spotify_now_playing"].execute("id", {})) as Record<string,unknown>;
    expect(data.playing).toBe(true);
    expect(data.track).toBe("Strobe");
    expect(data.artist).toBe("deadmau5");
    expect(data.device).toBe("Kitchen");
  });

  it("returns not playing when 204", async () => {
    vi.spyOn(fs, "readFileSync").mockImplementation((p, ...args) => {
      if (String(p) === TOKEN_CACHE) return FAKE_CACHE;
      return (fs.readFileSync as (p: unknown, ...a: unknown[]) => string)(p, ...args);
    });
    mockHttpsSeq(["", 204]);
    const { api } = await loadPlugin({ clientId: "cid", clientSecret: "csec" });
    const data = resultText(await api.tools["spotify_now_playing"].execute("id", {})) as Record<string,unknown>;
    expect(data.playing).toBe(false);
  });
});

describe("spotify_search", () => {
  it("returns error when query missing", async () => {
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["spotify_search"].execute("id", {}));
    expect(data).toHaveProperty("error");
  });

  it("searches and returns tracks", async () => {
    vi.spyOn(fs, "readFileSync").mockImplementation((p, ...args) => {
      if (String(p) === TOKEN_CACHE) return FAKE_CACHE;
      return (fs.readFileSync as (p: unknown, ...a: unknown[]) => string)(p, ...args);
    });
    mockHttpsSeq([SEARCH_RESULTS, 200]);
    const { api } = await loadPlugin({ clientId: "cid", clientSecret: "csec" });
    const data = resultText(await api.tools["spotify_search"].execute("id", { query: "Strobe", type: "track" })) as { count: number; items: unknown[] };
    expect(data.count).toBe(1);
    expect((data.items[0] as Record<string,unknown>).name).toBe("Strobe");
  });
});

describe("spotify_get_playlists", () => {
  it("returns playlists", async () => {
    vi.spyOn(fs, "readFileSync").mockImplementation((p, ...args) => {
      if (String(p) === TOKEN_CACHE) return FAKE_CACHE;
      return (fs.readFileSync as (p: unknown, ...a: unknown[]) => string)(p, ...args);
    });
    mockHttpsSeq([PLAYLISTS, 200]);
    const { api } = await loadPlugin({ clientId: "cid", clientSecret: "csec" });
    const data = resultText(await api.tools["spotify_get_playlists"].execute("id", {})) as { count: number; playlists: Array<Record<string,unknown>> };
    expect(data.count).toBe(1);
    expect(data.playlists[0].name).toBe("Chill");
  });
});

describe("spotify_get_devices", () => {
  it("returns device list", async () => {
    vi.spyOn(fs, "readFileSync").mockImplementation((p, ...args) => {
      if (String(p) === TOKEN_CACHE) return FAKE_CACHE;
      return (fs.readFileSync as (p: unknown, ...a: unknown[]) => string)(p, ...args);
    });
    mockHttpsSeq([DEVICES, 200]);
    const { api } = await loadPlugin({ clientId: "cid", clientSecret: "csec" });
    const data = resultText(await api.tools["spotify_get_devices"].execute("id", {})) as { devices: Array<Record<string,unknown>> };
    expect(data.devices[0].name).toBe("Kitchen Speaker");
  });
});
