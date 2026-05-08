/**
 * Home Assistant handlers — pure business logic, no plugin SDK or typebox imports.
 */

import fs from "node:fs";
import https from "node:https";
import http from "node:http";
import path from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface HomeAssistantConfig {
  server: string;
  token: string;
  captureDir: string;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpRequest(
  method: "GET" | "POST",
  url: string,
  headers: Record<string, string>,
  body?: string,
  timeoutMs = 30_000,
): Promise<{ status: number; body: string; rawBody: Buffer }> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const opts = { method, headers, timeout: timeoutMs };
    const req = mod.request(url, opts, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const rawBody = Buffer.concat(chunks);
        resolve({ status: res.statusCode ?? 0, body: rawBody.toString("utf8"), rawBody });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
    if (body) req.write(body);
    req.end();
  });
}

export async function apiGet(
  baseUrl: string,
  token: string,
  apiPath: string,
  timeoutMs = 30_000,
): Promise<{ output: unknown } | { error: string }> {
  const url = `${baseUrl}${apiPath}`;
  try {
    const res = await httpRequest("GET", url, {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    }, undefined, timeoutMs);
    if (res.status < 200 || res.status >= 300) {
      return { error: `HTTP ${res.status}: ${res.body.slice(0, 500)}` };
    }
    return { output: JSON.parse(res.body) };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function apiPost(
  baseUrl: string,
  token: string,
  apiPath: string,
  body: Record<string, unknown> = {},
  timeoutMs = 30_000,
): Promise<{ output: unknown } | { error: string }> {
  const url = `${baseUrl}${apiPath}`;
  try {
    const res = await httpRequest("POST", url, {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    }, JSON.stringify(body), timeoutMs);
    if (res.status < 200 || res.status >= 300) {
      return { error: `HTTP ${res.status}: ${res.body.slice(0, 500)}` };
    }
    return { output: JSON.parse(res.body) };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Entity helpers
// ---------------------------------------------------------------------------

export interface HassEntity {
  entity_id?: string;
  state?: string;
  attributes?: Record<string, unknown>;
  context?: unknown;
  [key: string]: unknown;
}

export function cleanEntity(entity: HassEntity, compact = false): unknown {
  if (typeof entity !== "object" || entity === null) return entity;
  const { context: _ctx, ...rest } = entity;
  if (compact) {
    return {
      entity_id: rest.entity_id,
      state: rest.state,
      friendly_name: (rest.attributes as Record<string, unknown>)?.friendly_name,
    };
  }
  return rest;
}

export function extractVolumeInfo(entity: HassEntity): unknown {
  const attrs = (entity.attributes ?? {}) as Record<string, unknown>;
  return {
    entity_id: entity.entity_id,
    friendly_name: attrs.friendly_name,
    state: entity.state,
    volume_level: attrs.volume_level,
    is_volume_muted: attrs.is_volume_muted,
  };
}

// ---------------------------------------------------------------------------
// Camera config
// ---------------------------------------------------------------------------

export const CAMERAS: Record<string, string> = {
  "living-room": "camera.living_room_camera_high_resolution_channel",
  "front-doorbell": "camera.front_doorbell_camera_high_resolution_channel",
  "front-doorbell-package": "camera.front_doorbell_camera_package_camera",
  "backyard-right": "camera.backyard_right_camera_high_resolution_channel",
  "backyard-left": "camera.backyard_left_camera_high_resolution_channel_2",
  driveway: "camera.driveway_camera_high_resolution_channel",
  "family-room": "camera.family_room_camera_high_resolution_channel",
  garage: "camera.garage_camera_high_resolution_channel",
};

export const DEFAULT_COLLAGE_CAMERAS = [
  "front-doorbell",
  "front-doorbell-package",
  "driveway",
  "backyard-left",
  "backyard-right",
  "garage",
];

export async function cameraSnapshot(
  baseUrl: string,
  token: string,
  name: string,
  entityId: string,
  captureDir: string,
): Promise<string | null> {
  fs.mkdirSync(captureDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const filePath = path.join(captureDir, `${name}_${ts}.jpg`);
  const url = `${baseUrl}/api/camera_proxy/${entityId}`;
  try {
    const res = await httpRequest("GET", url, { Authorization: `Bearer ${token}` }, undefined, 15_000);
    if (res.status < 200 || res.status >= 300) return null;
    const buf = res.rawBody;
    if (buf.length < 3 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    fs.writeFileSync(filePath, buf);
    return filePath;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function stateGet(config: HomeAssistantConfig, params: { entity_id: string }): Promise<unknown> {
  const { server, token } = config;
  const entityId = params.entity_id?.trim();
  if (!entityId) return { error: "entity_id is required" };
  const res = await apiGet(server, token, `/api/states/${encodeURIComponent(entityId)}`);
  if ("error" in res) return res;
  return { output: cleanEntity(res.output as HassEntity) };
}

export async function stateList(config: HomeAssistantConfig, params: { domain?: string }): Promise<unknown> {
  const { server, token } = config;
  const domain = params.domain?.trim() ?? "";
  const res = await apiGet(server, token, "/api/states", 60_000);
  if ("error" in res) return res;
  let data = res.output as HassEntity[];
  if (!Array.isArray(data)) return res;
  if (domain) data = data.filter((e) => e.entity_id?.startsWith(`${domain}.`));
  const compact = !domain || data.length > 100;
  const cleaned = data.map((e) => cleanEntity(e, compact));
  return { output: cleaned, count: cleaned.length };
}

export async function serviceCall(config: HomeAssistantConfig, params: { domain: string; service: string; entity_id?: string; data?: Record<string, unknown> }): Promise<unknown> {
  const { server, token } = config;
  const domain = params.domain?.trim();
  const service = params.service?.trim();
  if (!domain || !service) return { error: "domain and service are required" };
  const body: Record<string, unknown> = { ...(params.data ?? {}) };
  if (params.entity_id) body.entity_id = params.entity_id;
  const res = await apiPost(server, token, `/api/services/${domain}/${service}`, body);
  if ("error" in res) return res;
  return { output: res.output };
}

export async function eventList(config: HomeAssistantConfig, params: { entity_id?: string }): Promise<unknown> {
  const { server, token } = config;
  const res = await apiGet(server, token, "/api/events");
  if ("error" in res) return res;
  let data = res.output as Array<{ event_type?: string }>;
  const keyword = params.entity_id?.trim() ?? "";
  if (keyword && Array.isArray(data)) {
    data = data.filter((e) => (e.event_type ?? "").includes(keyword));
  }
  return { output: data };
}

export async function personFind(config: HomeAssistantConfig, params: { name?: string; entity_id?: string }): Promise<unknown> {
  const { server, token } = config;
  const name = params.name?.trim() ?? "";
  const entityId = params.entity_id?.trim() ?? "";
  if (!name && !entityId) return { error: "name or entity_id is required" };
  if (entityId) {
    const res = await apiGet(server, token, `/api/states/${encodeURIComponent(entityId)}`);
    if ("error" in res) return res;
    return { output: cleanEntity(res.output as HassEntity) };
  }
  const res = await apiGet(server, token, "/api/states", 30_000);
  if ("error" in res) return res;
  const data = res.output as HassEntity[];
  if (!Array.isArray(data)) return res;
  const nameLower = name.toLowerCase();
  const matches = data.filter((e) => {
    if (!e.entity_id?.startsWith("person.")) return false;
    const fn = String((e.attributes?.friendly_name ?? "")).toLowerCase();
    return fn.includes(nameLower) || (e.entity_id ?? "").toLowerCase().includes(nameLower);
  }).map((e) => cleanEntity(e));
  if (!matches.length) return { output: [], count: 0, message: `No person found matching '${name}'` };
  return { output: matches, count: matches.length };
}

export async function speakerVolumeGet(config: HomeAssistantConfig, params: { entity_id?: string }): Promise<unknown> {
  const { server, token } = config;
  const entityId = params.entity_id?.trim() ?? "";
  if (entityId) {
    const res = await apiGet(server, token, `/api/states/${encodeURIComponent(entityId)}`);
    if ("error" in res) return res;
    return { output: extractVolumeInfo(res.output as HassEntity) };
  }
  const res = await apiGet(server, token, "/api/states", 30_000);
  if ("error" in res) return res;
  const data = res.output as HassEntity[];
  if (!Array.isArray(data)) return res;
  const volumes = data.filter((e) => e.entity_id?.startsWith("media_player.")).map(extractVolumeInfo);
  return { output: volumes, count: volumes.length };
}

export async function speakerVolumeSet(config: HomeAssistantConfig, params: { entity_id: string; volume_level: number }): Promise<unknown> {
  const { server, token } = config;
  const entityId = params.entity_id?.trim();
  const volumeLevel = params.volume_level;
  if (!entityId) return { error: "entity_id is required" };
  if (isNaN(volumeLevel) || volumeLevel < 0 || volumeLevel > 1) return { error: "volume_level must be between 0.0 and 1.0" };
  const res = await apiPost(server, token, "/api/services/media_player/volume_set", {
    entity_id: entityId,
    volume_level: volumeLevel,
  });
  if ("error" in res) return res;
  return { output: res.output };
}

export async function logbook(config: HomeAssistantConfig, params: {
  entity_id?: string; hours?: number; start_time?: string; end_time?: string; keyword?: string; limit?: number;
}): Promise<unknown> {
  const { server, token } = config;
  const hours = params.hours ?? 24;
  const entityId = params.entity_id?.trim() ?? "";
  const keyword = params.keyword?.trim().toLowerCase() ?? "";
  const limit = Math.min(params.limit ?? 100, 500);

  const startDt = params.start_time ?? new Date(Date.now() - hours * 3_600_000).toISOString();
  let url = `/api/logbook/${encodeURIComponent(startDt)}`;
  const qs: string[] = [];
  if (params.end_time) qs.push(`end_time=${encodeURIComponent(params.end_time)}`);
  if (entityId) qs.push(`entity=${encodeURIComponent(entityId)}`);
  if (qs.length) url += `?${qs.join("&")}`;

  const res = await apiGet(server, token, url, 15_000);
  if ("error" in res) return res;
  let entries = res.output as Array<Record<string, string>>;
  if (!Array.isArray(entries)) return { error: "Unexpected response from HA logbook API" };

  if (keyword) {
    entries = entries.filter((e) =>
      (e.name ?? "").toLowerCase().includes(keyword) ||
      (e.message ?? "").toLowerCase().includes(keyword) ||
      (e.entity_id ?? "").toLowerCase().includes(keyword) ||
      (e.state ?? "").toLowerCase().includes(keyword),
    );
  }
  entries = entries.slice(0, limit);
  const cleaned = entries.map((e) => ({
    when: e.when, entity_id: e.entity_id, name: e.name,
    state: e.state, message: e.message, domain: e.domain,
  }));
  return { count: cleaned.length, entries: cleaned };
}

export async function cameraList(): Promise<unknown> {
  return { cameras: Object.entries(CAMERAS).map(([name, entity_id]) => ({ name, entity_id })) };
}

export async function cameraSnapshotHandler(config: HomeAssistantConfig, params: { camera_name: string }): Promise<unknown> {
  const { server, token, captureDir } = config;
  const name = params.camera_name?.trim();
  if (!name) return { error: "camera_name is required" };

  if (name === "all") {
    const results: Array<{ camera: string; file: string }> = [];
    const failed: string[] = [];
    for (const [camName, entityId] of Object.entries(CAMERAS)) {
      const file = await cameraSnapshot(server, token, camName, entityId, captureDir);
      if (file) results.push({ camera: camName, file });
      else failed.push(camName);
    }
    return { snapshots: results, ...(failed.length ? { failed } : {}) };
  }

  if (!(name in CAMERAS)) {
    return { error: `Unknown camera: '${name}'`, available: [...Object.keys(CAMERAS), "all"] };
  }
  const file = await cameraSnapshot(server, token, name, CAMERAS[name], captureDir);
  if (file) return { camera: name, file };
  return { error: `Snapshot failed for camera '${name}'` };
}

export async function cameraCollageHandler(config: HomeAssistantConfig, params: { camera_names?: string[]; label?: boolean }): Promise<unknown> {
  const { server, token, captureDir } = config;
  const requestedNames = params.camera_names ?? DEFAULT_COLLAGE_CAMERAS;
  const drawLabel = params.label !== false;

  const unknown = requestedNames.filter((n) => !(n in CAMERAS));
  if (unknown.length) return { error: `Unknown cameras: ${unknown}`, available: Object.keys(CAMERAS) };

  const snapshots: Array<[string, string]> = [];
  const failed: string[] = [];
  for (const camName of requestedNames) {
    const file = await cameraSnapshot(server, token, camName, CAMERAS[camName], captureDir);
    if (file) snapshots.push([camName, file]);
    else failed.push(camName);
  }
  if (!snapshots.length) return { error: "All camera snapshots failed", failed };

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  const n = snapshots.length;
  const cols = Math.ceil(Math.sqrt(n));
  const scaleW = 640, scaleH = 360;

  const filterParts: string[] = [];
  for (let i = 0; i < n; i++) {
    const [camName] = snapshots[i];
    let f = `[${i}:v]scale=${scaleW}:${scaleH}:force_original_aspect_ratio=decrease,pad=${scaleW}:${scaleH}:(ow-iw)/2:(oh-ih)/2`;
    if (drawLabel) {
      f += `,drawtext=text='${camName}':fontsize=18:fontcolor=white:x=10:y=h-th-10:box=1:boxcolor=black@0.5:boxborderw=4`;
    }
    f += `[v${i}]`;
    filterParts.push(f);
  }

  const layout = Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / cols), col = i % cols;
    return `${col > 0 ? col * scaleW : 0}_${row > 0 ? row * scaleH : 0}`;
  }).join("|");

  filterParts.push(`${Array.from({ length: n }, (_, i) => `[v${i}]`).join("")}xstack=inputs=${n}:layout=${layout}[out]`);

  const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  fs.mkdirSync(captureDir, { recursive: true });
  const outPath = path.join(captureDir, `collage_${ts}.jpg`);

  const args = ["-y"];
  for (const [, file] of snapshots) args.push("-i", file);
  args.push("-filter_complex", filterParts.join(";"), "-map", "[out]", "-frames:v", "1", "-update", "1", "-q:v", "3", outPath);

  try {
    await execFileAsync("ffmpeg", args, { timeout: 30_000 });
  } catch (e: unknown) {
    const err = e as { stderr?: string; message?: string };
    return { error: "ffmpeg error", detail: (err.stderr ?? err.message ?? String(e)).slice(-500) };
  }

  const sizeKb = Math.round(fs.statSync(outPath).size / 1024);
  return {
    file: outPath,
    cameras: snapshots.map(([n]) => n),
    size_kb: sizeKb,
    ...(failed.length ? { failed } : {}),
  };
}
