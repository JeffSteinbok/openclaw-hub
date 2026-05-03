/**
 * Home Assistant plugin — pure TS-native implementation.
 *
 * Calls the HA REST API directly via Node's built-in http/https modules.
 * No Python bridge required.
 */

import fs from "node:fs";
import https from "node:https";
import http from "node:http";
import path from "node:path";
import { Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PluginApi = {
  registerTool: (tool: unknown) => void;
  pluginConfig?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpRequest(
  method: "GET" | "POST",
  url: string,
  headers: Record<string, string>,
  body?: string,
  timeoutMs = 30_000,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const opts = { method, headers, timeout: timeoutMs };
    const req = mod.request(url, opts, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    if (body) req.write(body);
    req.end();
  });
}

async function apiGet(
  baseUrl: string,
  token: string,
  path: string,
  timeoutMs = 30_000,
): Promise<{ output: unknown } | { error: string }> {
  const url = `${baseUrl}${path}`;
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

async function apiPost(
  baseUrl: string,
  token: string,
  path: string,
  body: Record<string, unknown> = {},
  timeoutMs = 30_000,
): Promise<{ output: unknown } | { error: string }> {
  const url = `${baseUrl}${path}`;
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

interface HassEntity {
  entity_id?: string;
  state?: string;
  attributes?: Record<string, unknown>;
  context?: unknown;
  [key: string]: unknown;
}

function cleanEntity(entity: HassEntity, compact = false): unknown {
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

function extractVolumeInfo(entity: HassEntity): unknown {
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

const CAMERAS: Record<string, string> = {
  "living-room": "camera.living_room_camera_high_resolution_channel",
  "front-doorbell": "camera.front_doorbell_camera_high_resolution_channel",
  "front-doorbell-package": "camera.front_doorbell_camera_package_camera",
  "backyard-right": "camera.backyard_right_camera_high_resolution_channel",
  "backyard-left": "camera.backyard_left_camera_high_resolution_channel_2",
  driveway: "camera.driveway_camera_high_resolution_channel",
  "family-room": "camera.family_room_camera_high_resolution_channel",
  garage: "camera.garage_camera_high_resolution_channel",
};

const CAPTURE_DIR = "/tmp/openclaw/camera_captures";
const DEFAULT_COLLAGE_CAMERAS = [
  "front-doorbell",
  "front-doorbell-package",
  "driveway",
  "backyard-left",
  "backyard-right",
  "garage",
];

async function cameraSnapshot(
  baseUrl: string,
  token: string,
  name: string,
  entityId: string,
): Promise<string | null> {
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const filePath = path.join(CAPTURE_DIR, `${name}_${ts}.jpg`);
  const url = `${baseUrl}/api/camera_proxy/${entityId}`;
  try {
    const res = await httpRequest("GET", url, { Authorization: `Bearer ${token}` }, undefined, 15_000);
    if (res.status < 200 || res.status >= 300) return null;
    const buf = Buffer.from(res.body, "binary");
    if (buf.length < 3 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    fs.writeFileSync(filePath, buf);
    return filePath;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

function formatResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data) }],
    details: {},
  };
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    server: { type: "string" as const, description: "Home Assistant server URL (e.g. http://192.168.1.76:8123)" },
    token: { type: "string" as const, description: "Home Assistant long-lived access token" },
  },
};

function createEntry() {
  return {
    id: "homeassistant",
    name: "Home Assistant",
    description: "Control devices, query state, and inspect activity in Home Assistant",
    configSchema,
    register(api: PluginApi) {
      const getConfig = () => ({
        server: ((api.pluginConfig?.server as string) ?? process.env.HASS_SERVER ?? "http://192.168.1.76:8123").replace(/\/+$/, ""),
        token: (api.pluginConfig?.token as string) ?? process.env.HASS_TOKEN ?? "",
      });

      // hass_state_get
      api.registerTool({
        name: "hass_state_get",
        label: "HA State Get",
        description: "Get the current state of a Home Assistant entity.",
        parameters: Type.Object({
          entity_id: Type.String({ description: "The entity ID to query (e.g. light.living_room, sensor.temperature)." }),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          const { server, token } = getConfig();
          const entityId = String(params.entity_id ?? "");
          if (!entityId) return formatResult({ error: "entity_id is required" });
          const res = await apiGet(server, token, `/api/states/${encodeURIComponent(entityId)}`);
          if ("error" in res) return formatResult(res);
          return formatResult({ output: cleanEntity(res.output as HassEntity) });
        },
      });

      // hass_state_list
      api.registerTool({
        name: "hass_state_list",
        label: "HA State List",
        description: "List Home Assistant entities, optionally filtered by domain.",
        parameters: Type.Object({
          domain: Type.Optional(Type.String({ description: "Optional domain to filter by (e.g. light, switch, sensor)." })),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          const { server, token } = getConfig();
          const domain = String(params.domain ?? "").trim();
          const res = await apiGet(server, token, "/api/states", 60_000);
          if ("error" in res) return formatResult(res);
          let data = res.output as HassEntity[];
          if (!Array.isArray(data)) return formatResult(res);
          if (domain) data = data.filter((e) => e.entity_id?.startsWith(`${domain}.`));
          const compact = !domain || data.length > 100;
          const cleaned = data.map((e) => cleanEntity(e, compact));
          return formatResult({ output: cleaned, count: cleaned.length });
        },
      });

      // hass_service_call
      api.registerTool({
        name: "hass_service_call",
        label: "HA Service Call",
        description: "Call a Home Assistant service.",
        parameters: Type.Object({
          domain: Type.String({ description: "Service domain (e.g. light, switch, scene, climate)." }),
          service: Type.String({ description: "Service name (e.g. turn_on, turn_off, toggle)." }),
          entity_id: Type.Optional(Type.String({ description: "Target entity ID (e.g. light.living_room)." })),
          data: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
            description: "Additional service data as key-value pairs (e.g. {\"brightness\": 128}).",
          })),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          const { server, token } = getConfig();
          const domain = String(params.domain ?? "").trim();
          const service = String(params.service ?? "").trim();
          if (!domain || !service) return formatResult({ error: "domain and service are required" });
          const body: Record<string, unknown> = { ...(params.data as Record<string, unknown> ?? {}) };
          if (params.entity_id) body.entity_id = params.entity_id;
          const res = await apiPost(server, token, `/api/services/${domain}/${service}`, body);
          if ("error" in res) return formatResult(res);
          return formatResult({ output: res.output });
        },
      });

      // hass_event_list
      api.registerTool({
        name: "hass_event_list",
        label: "HA Event List",
        description: "List Home Assistant event types.",
        parameters: Type.Object({
          entity_id: Type.Optional(Type.String({ description: "Optional keyword to filter event types by string match." })),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          const { server, token } = getConfig();
          const res = await apiGet(server, token, "/api/events");
          if ("error" in res) return formatResult(res);
          let data = res.output as Array<{ event_type?: string }>;
          const keyword = String(params.entity_id ?? "").trim();
          if (keyword && Array.isArray(data)) {
            data = data.filter((e) => (e.event_type ?? "").includes(keyword));
          }
          return formatResult({ output: data });
        },
      });

      // hass_person_find
      api.registerTool({
        name: "hass_person_find",
        label: "HA Person Find",
        description: "Find a Home Assistant person by name or entity ID.",
        parameters: Type.Object({
          name: Type.Optional(Type.String({ description: "Name of the person to search for (case-insensitive substring match)." })),
          entity_id: Type.Optional(Type.String({ description: "Exact entity ID to look up (e.g. person.john)." })),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          const { server, token } = getConfig();
          const name = String(params.name ?? "").trim();
          const entityId = String(params.entity_id ?? "").trim();
          if (!name && !entityId) return formatResult({ error: "name or entity_id is required" });
          if (entityId) {
            const res = await apiGet(server, token, `/api/states/${encodeURIComponent(entityId)}`);
            if ("error" in res) return formatResult(res);
            return formatResult({ output: cleanEntity(res.output as HassEntity) });
          }
          const res = await apiGet(server, token, "/api/states", 30_000);
          if ("error" in res) return formatResult(res);
          const data = res.output as HassEntity[];
          if (!Array.isArray(data)) return formatResult(res);
          const nameLower = name.toLowerCase();
          const matches = data.filter((e) => {
            if (!e.entity_id?.startsWith("person.")) return false;
            const fn = String((e.attributes?.friendly_name ?? "")).toLowerCase();
            return fn.includes(nameLower) || (e.entity_id ?? "").toLowerCase().includes(nameLower);
          }).map((e) => cleanEntity(e));
          if (!matches.length) return formatResult({ output: [], count: 0, message: `No person found matching '${name}'` });
          return formatResult({ output: matches, count: matches.length });
        },
      });

      // hass_speaker_volume_get
      api.registerTool({
        name: "hass_speaker_volume_get",
        label: "HA Speaker Volume Get",
        description: "Get the volume level of one speaker or all speakers.",
        parameters: Type.Object({
          entity_id: Type.Optional(Type.String({ description: "Optional entity ID of the speaker (e.g. media_player.living_room)." })),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          const { server, token } = getConfig();
          const entityId = String(params.entity_id ?? "").trim();
          if (entityId) {
            const res = await apiGet(server, token, `/api/states/${encodeURIComponent(entityId)}`);
            if ("error" in res) return formatResult(res);
            return formatResult({ output: extractVolumeInfo(res.output as HassEntity) });
          }
          const res = await apiGet(server, token, "/api/states", 30_000);
          if ("error" in res) return formatResult(res);
          const data = res.output as HassEntity[];
          if (!Array.isArray(data)) return formatResult(res);
          const volumes = data.filter((e) => e.entity_id?.startsWith("media_player.")).map(extractVolumeInfo);
          return formatResult({ output: volumes, count: volumes.length });
        },
      });

      // hass_speaker_volume_set
      api.registerTool({
        name: "hass_speaker_volume_set",
        label: "HA Speaker Volume Set",
        description: "Set the volume level of a speaker.",
        parameters: Type.Object({
          entity_id: Type.String({ description: "Entity ID of the speaker to adjust (e.g. media_player.living_room)." }),
          volume_level: Type.Number({ description: "Desired volume level between 0.0 (silent) and 1.0 (maximum).", minimum: 0, maximum: 1 }),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          const { server, token } = getConfig();
          const entityId = String(params.entity_id ?? "").trim();
          const volumeLevel = Number(params.volume_level);
          if (!entityId) return formatResult({ error: "entity_id is required" });
          if (isNaN(volumeLevel) || volumeLevel < 0 || volumeLevel > 1)
            return formatResult({ error: "volume_level must be between 0.0 and 1.0" });
          const res = await apiPost(server, token, "/api/services/media_player/volume_set", {
            entity_id: entityId,
            volume_level: volumeLevel,
          });
          if ("error" in res) return formatResult(res);
          return formatResult({ output: res.output });
        },
      });

      // hass_logbook
      api.registerTool({
        name: "hass_logbook",
        label: "HA Logbook",
        description: "Get Home Assistant logbook entries with optional filters.",
        parameters: Type.Object({
          entity_id: Type.Optional(Type.String({ description: "Filter entries for a specific entity." })),
          hours: Type.Optional(Type.Number({ description: "Rolling window in hours from now (default: 24). Ignored if start_time is provided." })),
          start_time: Type.Optional(Type.String({ description: "Start of the time range as an ISO 8601 string." })),
          end_time: Type.Optional(Type.String({ description: "End of the time range as an ISO 8601 string. Defaults to now." })),
          keyword: Type.Optional(Type.String({ description: "Optional keyword to filter entries." })),
          limit: Type.Optional(Type.Integer({ description: "Maximum number of entries to return (default: 100, max: 500)." })),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          const { server, token } = getConfig();
          const hours = Number(params.hours ?? 24);
          const startTime = params.start_time as string | undefined;
          const endTime = params.end_time as string | undefined;
          const entityId = String(params.entity_id ?? "").trim();
          const keyword = String(params.keyword ?? "").trim().toLowerCase();
          const limit = Math.min(Number(params.limit ?? 100), 500);

          const startDt = startTime ?? new Date(Date.now() - hours * 3_600_000).toISOString();
          let url = `/api/logbook/${encodeURIComponent(startDt)}`;
          const qs: string[] = [];
          if (endTime) qs.push(`end_time=${encodeURIComponent(endTime)}`);
          if (entityId) qs.push(`entity=${encodeURIComponent(entityId)}`);
          if (qs.length) url += `?${qs.join("&")}`;

          const res = await apiGet(server, token, url, 15_000);
          if ("error" in res) return formatResult(res);
          let entries = res.output as Array<Record<string, string>>;
          if (!Array.isArray(entries)) return formatResult({ error: "Unexpected response from HA logbook API" });

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
            when: e.when,
            entity_id: e.entity_id,
            name: e.name,
            state: e.state,
            message: e.message,
            domain: e.domain,
          }));
          return formatResult({ count: cleaned.length, entries: cleaned });
        },
      });

      // hass_camera_list
      api.registerTool({
        name: "hass_camera_list",
        label: "HA Camera List",
        description: "List available Home Assistant cameras.",
        parameters: Type.Object({}),
        async execute() {
          return formatResult({
            cameras: Object.entries(CAMERAS).map(([name, entity_id]) => ({ name, entity_id })),
          });
        },
      });

      // hass_camera_snapshot
      api.registerTool({
        name: "hass_camera_snapshot",
        label: "HA Camera Snapshot",
        description: "Take a snapshot from a Home Assistant camera.",
        parameters: Type.Object({
          camera_name: Type.String({
            description:
              "Name of the camera to snapshot. One of: living-room, front-doorbell, front-doorbell-package, backyard-right, backyard-left, driveway, family-room, garage, all",
          }),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          const { server, token } = getConfig();
          const name = String(params.camera_name ?? "").trim();
          if (!name) return formatResult({ error: "camera_name is required" });

          if (name === "all") {
            const results: Array<{ camera: string; file: string }> = [];
            const failed: string[] = [];
            for (const [camName, entityId] of Object.entries(CAMERAS)) {
              const file = await cameraSnapshot(server, token, camName, entityId);
              if (file) results.push({ camera: camName, file });
              else failed.push(camName);
            }
            return formatResult({ snapshots: results, ...(failed.length ? { failed } : {}) });
          }

          if (!(name in CAMERAS)) {
            return formatResult({ error: `Unknown camera: '${name}'`, available: [...Object.keys(CAMERAS), "all"] });
          }
          const file = await cameraSnapshot(server, token, name, CAMERAS[name]);
          if (file) return formatResult({ camera: name, file });
          return formatResult({ error: `Snapshot failed for camera '${name}'` });
        },
      });

      // hass_camera_collage
      api.registerTool({
        name: "hass_camera_collage",
        label: "HA Camera Collage",
        description:
          "Snapshot multiple cameras simultaneously and compose them into a grid collage image. Defaults to all outdoor + garage cameras. Returns a single local file path to the collage image.",
        parameters: Type.Object({
          camera_names: Type.Optional(Type.Array(Type.String(), {
            description:
              "List of camera names to include. Defaults to all outdoor + garage cameras: front-doorbell, front-doorbell-package, driveway, backyard-left, backyard-right, garage. Available: living-room, front-doorbell, front-doorbell-package, backyard-right, backyard-left, driveway, family-room, garage.",
          })),
          label: Type.Optional(Type.Boolean({ description: "Draw camera name labels on each cell (default: true)." })),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          const { server, token } = getConfig();
          const requestedNames = (params.camera_names as string[] | undefined) ?? DEFAULT_COLLAGE_CAMERAS;
          const drawLabel = params.label !== false;

          const unknown = requestedNames.filter((n) => !(n in CAMERAS));
          if (unknown.length) return formatResult({ error: `Unknown cameras: ${unknown}`, available: Object.keys(CAMERAS) });

          const snapshots: Array<[string, string]> = [];
          const failed: string[] = [];
          for (const camName of requestedNames) {
            const file = await cameraSnapshot(server, token, camName, CAMERAS[camName]);
            if (file) snapshots.push([camName, file]);
            else failed.push(camName);
          }
          if (!snapshots.length) return formatResult({ error: "All camera snapshots failed", failed });

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
          fs.mkdirSync(CAPTURE_DIR, { recursive: true });
          const outPath = path.join(CAPTURE_DIR, `collage_${ts}.jpg`);

          const args = ["-y"];
          for (const [, file] of snapshots) args.push("-i", file);
          args.push("-filter_complex", filterParts.join(";"), "-map", "[out]", "-frames:v", "1", "-update", "1", "-q:v", "3", outPath);

          try {
            await execFileAsync("ffmpeg", args, { timeout: 30_000 });
          } catch (e: unknown) {
            const err = e as { stderr?: string; message?: string };
            return formatResult({ error: "ffmpeg error", detail: (err.stderr ?? err.message ?? String(e)).slice(-500) });
          }

          const sizeKb = Math.round(fs.statSync(outPath).size / 1024);
          return formatResult({
            file: outPath,
            cameras: snapshots.map(([n]) => n),
            size_kb: sizeKb,
            ...(failed.length ? { failed } : {}),
          });
        },
      });
    },
  };
}

export { createEntry };
