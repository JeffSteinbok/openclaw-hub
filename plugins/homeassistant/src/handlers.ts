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
  method: "GET" | "POST" | "PUT",
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

export async function apiPut(
  baseUrl: string,
  token: string,
  apiPath: string,
  body: Record<string, unknown> = {},
  timeoutMs = 30_000,
): Promise<{ output: unknown } | { error: string }> {
  const url = `${baseUrl}${apiPath}`;
  try {
    const res = await httpRequest("PUT", url, {
      Authorization: "Bearer " + token,
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

interface LovelaceDashboard {
  id?: string;
  path?: string;
  title?: string;
  url_path?: string;
}

function normalizeLovelaceNameOrPath(value: string): string {
  return value.trim().toLowerCase().replace(/^\/+|\/+$/g, "");
}

function lovelaceConfigPath(dashboardId?: string): string {
  return dashboardId ? `/api/lovelace/${encodeURIComponent(dashboardId)}/config` : "/api/lovelace/config";
}

function extractDashboardId(match: LovelaceDashboard, fallback: string): string {
  return String(match.url_path ?? match.id ?? match.path ?? fallback).trim();
}

async function resolveLovelaceDashboard(
  config: HomeAssistantConfig,
  dashboard?: string,
): Promise<{ path: string; dashboard?: string; title?: string } | { error: string }> {
  const selected = dashboard?.trim() ?? "";
  const normalized = normalizeLovelaceNameOrPath(selected);
  if (!selected || normalized === "default" || normalized === "lovelace") {
    return { path: lovelaceConfigPath() };
  }

  const res = await apiGet(config.server, config.token, "/api/lovelace/dashboards");
  if ("error" in res) return res;

  const dashboards = Array.isArray(res.output) ? res.output as LovelaceDashboard[] : [];
  const match = dashboards.find((entry) =>
    [entry.url_path, entry.title, entry.id, entry.path]
      .filter((value): value is string => typeof value === "string")
      .some((value) => normalizeLovelaceNameOrPath(value) === normalized),
  );

  if (!match) return { path: lovelaceConfigPath(selected), dashboard: selected };

  const dashboardId = extractDashboardId(match, selected);
  return { path: lovelaceConfigPath(dashboardId), dashboard: dashboardId, title: match.title };
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

/** Entity counts per domain — what an unfiltered list returns instead of dumping every entity. */
function summarizeDomains(data: HassEntity[]): unknown {
  const counts = new Map<string, number>();
  for (const e of data) {
    const domain = e.entity_id?.split(".")[0];
    if (domain) counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  const domains = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([domain, count]) => ({ domain, count }));
  return {
    total: data.length,
    domains,
    hint: "No domain or search given, so only per-domain counts are returned. Call again with domain (e.g. \"light\" or \"light,fan\") and/or search (e.g. \"bonus room\").",
  };
}

export async function stateList(config: HomeAssistantConfig, params: { domain?: string; search?: string }): Promise<unknown> {
  const { server, token } = config;
  const domains = (params.domain ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/\.$/, ""))
    .filter(Boolean);
  const search = params.search?.trim().toLowerCase() ?? "";
  const res = await apiGet(server, token, "/api/states", 60_000);
  if ("error" in res) return res;
  let data = res.output as HassEntity[];
  if (!Array.isArray(data)) return res;
  if (domains.length === 0 && !search) return summarizeDomains(data);
  if (domains.length > 0) data = data.filter((e) => domains.some((d) => e.entity_id?.startsWith(`${d}.`)));
  if (search) {
    // "bonus room" should match light.bonus_room_lights as well as the friendly name
    const idNeedle = search.replace(/\s+/g, "_");
    data = data.filter((e) => {
      const name = String((e.attributes as Record<string, unknown> | undefined)?.friendly_name ?? "").toLowerCase();
      return e.entity_id?.toLowerCase().includes(idNeedle) || name.includes(search);
    });
  }
  const compact = domains.length === 0 || data.length > 100;
  const cleaned = data.map((e) => cleanEntity(e, compact));
  return { output: cleaned, count: cleaned.length };
}

/** Attributes worth showing the model, per domain (state and name are always shown). */
const VIEW_ATTRIBUTES: Record<string, string[]> = {
  light: ["brightness"],
  climate: ["hvac_action", "current_temperature", "temperature", "target_temp_low", "target_temp_high"],
  cover: ["current_position"],
  fan: ["percentage"],
  media_player: ["media_title", "media_artist", "source", "volume_level"],
  sensor: ["unit_of_measurement"],
  water_heater: ["temperature"],
};

function viewValue(key: string, value: unknown): string {
  if (key === "brightness" && typeof value === "number") return `${Math.round((value / 255) * 100)}%`;
  if (key === "volume_level" && typeof value === "number") return `volume ${Math.round(value * 100)}%`;
  return String(value);
}

/**
 * What the model reads from hass_state_list: one line per entity,
 * `entity_id "Friendly name": state (useful attributes)`. The full result
 * stays in `details` for code (e.g. condensers).
 */
export function stateListView(result: unknown): unknown {
  const r = result as { output?: unknown; count?: number };
  if (!Array.isArray(r?.output)) return result; // domain counts, errors: already small
  const lines = (r.output as HassEntity[]).map((e) => {
    const attrs = (e.attributes ?? {}) as Record<string, unknown>;
    const name = attrs.friendly_name ?? (e as { friendly_name?: unknown }).friendly_name;
    const extras = (VIEW_ATTRIBUTES[e.entity_id?.split(".")[0] ?? ""] ?? [])
      .filter((k) => attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== "")
      .map((k) => (k === "unit_of_measurement" ? String(attrs[k]) : `${k.replace(/_/g, " ")} ${viewValue(k, attrs[k])}`));
    const state = extras.length && e.entity_id?.startsWith("sensor.") ? `${e.state} ${extras.join(" ")}` : e.state;
    const rest = extras.length && !e.entity_id?.startsWith("sensor.") ? ` (${extras.join(", ")})` : "";
    return `${e.entity_id}${name ? ` "${String(name)}"` : ""}: ${state}${rest}`;
  });
  return `${r.count ?? lines.length} entities\n${lines.join("\n")}`;
}

export async function serviceCall(config: HomeAssistantConfig, params: { domain: string; service: string; entity_id?: string; data?: Record<string, unknown> }): Promise<unknown> {
  const { server, token } = config;
  const domain = params.domain?.trim();
  const service = params.service?.trim();
  if (!domain || !service) return { error: "domain and service are required" };
  const body: Record<string, unknown> = { ...(params.data ?? {}) };
  if (params.entity_id) body.entity_id = params.entity_id;
  const started = Date.now();
  const res = await apiPost(server, token, `/api/services/${domain}/${service}`, body);
  if ("error" in res) return res;
  if (!Array.isArray(res.output) || res.output.length > 0) return { output: res.output };

  // HA often replies before the device reports back, so an empty list doesn't
  // mean nothing happened. Re-read the entities before saying anything.
  const ids = (params.entity_id ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10);
  if (ids.length === 0) {
    return { output: [], warning: "Home Assistant reported no state change. Check the entity with hass_state_get before telling the user it worked." };
  }
  await new Promise((r) => setTimeout(r, recheck.delayMs));
  const states = await Promise.all(ids.map((id) => recheckEntity(config, id, started)));
  const missing = states.filter((s) => s.error).map((s) => s.entity_id);
  const unchanged = states.filter((s) => !s.error && !s.updated).map((s) => `${s.entity_id} is ${s.state}`);
  if (missing.length === 0 && unchanged.length === 0) return { output: [], states };
  const problems = [
    ...(missing.length ? [`not found: ${missing.join(", ")} (look it up with hass_state_list)`] : []),
    ...(unchanged.length ? [`no update since the call: ${unchanged.join(", ")} (it was already like that, or the device didn't respond)`] : []),
  ];
  return { output: [], states, warning: `Not confirmed — ${problems.join("; ")}. Tell the user what the state is now; don't claim the call changed it.` };
}

/** Delay before re-reading entities after an empty service_call reply. Tests set it to 0. */
export const recheck = { delayMs: 1500 };

// Clock slack between this host and Home Assistant.
const RECHECK_SLACK_MS = 5000;

async function recheckEntity(
  config: HomeAssistantConfig,
  id: string,
  since: number,
): Promise<{ entity_id: string; state?: string; updated?: boolean; error?: string }> {
  const r = await apiGet(config.server, config.token, `/api/states/${encodeURIComponent(id)}`, 10_000);
  if ("error" in r) return { entity_id: id, error: r.error.startsWith("HTTP 404") ? "not found" : r.error };
  const e = r.output as HassEntity;
  const updatedAt = Date.parse(String(e.last_updated ?? e.last_changed ?? ""));
  return { entity_id: id, state: e.state, updated: Number.isFinite(updatedAt) && updatedAt >= since - RECHECK_SLACK_MS };
}

export async function lovelaceGet(
  config: HomeAssistantConfig,
  params: { dashboard?: string; view?: string },
): Promise<unknown> {
  const resolved = await resolveLovelaceDashboard(config, params.dashboard);
  if ("error" in resolved) return resolved;

  const res = await apiGet(config.server, config.token, resolved.path, 60_000);
  if ("error" in res) return res;

  const viewName = params.view?.trim() ?? "";
  if (!viewName) {
    return {
      output: res.output,
      ...(resolved.dashboard ? { dashboard: resolved.dashboard } : {}),
      ...(resolved.title ? { title: resolved.title } : {}),
    };
  }

  const views = (res.output as { views?: Array<Record<string, unknown>> })?.views;
  if (!Array.isArray(views)) {
    return { error: "Dashboard config does not contain a views array" };
  }

  const normalized = normalizeLovelaceNameOrPath(viewName);
  const match = views.find((view) =>
    [view.title, view.path]
      .filter((value): value is string => typeof value === "string")
      .some((value) => normalizeLovelaceNameOrPath(value) === normalized),
  );

  if (!match) {
    return {
      error: `View '${viewName}' not found`,
      available_views: views
        .map((view) => typeof view.title === "string" ? view.title : typeof view.path === "string" ? view.path : null)
        .filter((value): value is string => value !== null),
    };
  }

  return {
    output: match,
    view: typeof match.title === "string" ? match.title : typeof match.path === "string" ? match.path : viewName,
    ...(resolved.dashboard ? { dashboard: resolved.dashboard } : {}),
    ...(resolved.title ? { title: resolved.title } : {}),
  };
}

export async function lovelaceSet(
  config: HomeAssistantConfig,
  params: { dashboard?: string; config: Record<string, unknown> },
): Promise<unknown> {
  if (!params.config || typeof params.config !== "object" || Array.isArray(params.config)) {
    return { error: "config must be a non-null object" };
  }

  const resolved = await resolveLovelaceDashboard(config, params.dashboard);
  if ("error" in resolved) return resolved;

  const res = await apiPut(config.server, config.token, resolved.path, params.config, 60_000);
  if ("error" in res) return res;
  return {
    output: res.output,
    ...(resolved.dashboard ? { dashboard: resolved.dashboard } : {}),
    ...(resolved.title ? { title: resolved.title } : {}),
  };
}

// Automation and script configs live behind /api/config/<kind>/config/<id>,
// which requires an admin token. Automations are keyed by their `id` attribute
// (not the entity object id); scripts are keyed by their entity object id.
export type ConfigKind = "automation" | "script";

async function resolveConfigId(
  config: HomeAssistantConfig,
  kind: ConfigKind,
  ref: string,
): Promise<{ id: string } | { error: string }> {
  const value = ref.trim();
  if (!value) return { error: "id is required" };
  if (!value.startsWith(`${kind}.`)) return { id: value };
  if (kind === "script") return { id: value.slice("script.".length) };

  const res = await apiGet(config.server, config.token, `/api/states/${encodeURIComponent(value)}`);
  if ("error" in res) return res;
  const id = (res.output as HassEntity).attributes?.id;
  if (typeof id !== "string" || !id) {
    return { error: `${value} has no config id (it may be defined in YAML outside automations.yaml)` };
  }
  return { id };
}

export async function configList(config: HomeAssistantConfig, params: { kind: ConfigKind }): Promise<unknown> {
  const { kind } = params;
  const res = await apiGet(config.server, config.token, "/api/states", 60_000);
  if ("error" in res) return res;
  const data = res.output as HassEntity[];
  if (!Array.isArray(data)) return res;
  const items = data
    .filter((e) => e.entity_id?.startsWith(`${kind}.`))
    .map((e) => {
      const attrs = (e.attributes ?? {}) as Record<string, unknown>;
      return {
        id: kind === "script" ? e.entity_id!.slice("script.".length) : attrs.id,
        entity_id: e.entity_id,
        alias: attrs.friendly_name,
        state: e.state,
        last_triggered: attrs.last_triggered,
      };
    });
  return { output: items, count: items.length };
}

export async function configGet(config: HomeAssistantConfig, params: { kind: ConfigKind; id: string }): Promise<unknown> {
  const resolved = await resolveConfigId(config, params.kind, params.id ?? "");
  if ("error" in resolved) return resolved;
  const res = await apiGet(
    config.server,
    config.token,
    `/api/config/${params.kind}/config/${encodeURIComponent(resolved.id)}`,
  );
  if ("error" in res) return res;
  return { output: res.output, id: resolved.id };
}

export async function configSet(
  config: HomeAssistantConfig,
  params: { kind: ConfigKind; id?: string; config: Record<string, unknown> },
): Promise<unknown> {
  if (!params.config || typeof params.config !== "object" || Array.isArray(params.config)) {
    return { error: "config must be a non-null object" };
  }

  let id: string;
  if (params.id?.trim()) {
    const resolved = await resolveConfigId(config, params.kind, params.id);
    if ("error" in resolved) return resolved;
    id = resolved.id;
  } else if (params.kind === "automation") {
    // Same scheme the HA UI uses for new automations.
    id = String(Date.now());
  } else {
    return { error: "id is required for scripts (it becomes the script.<id> entity)" };
  }

  const res = await apiPost(
    config.server,
    config.token,
    `/api/config/${params.kind}/config/${encodeURIComponent(id)}`,
    params.config,
  );
  if ("error" in res) return res;
  return { output: res.output, id };
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

// ---------------------------------------------------------------------------
// Notify (restricted to configured targets)
// ---------------------------------------------------------------------------

export interface NotifyTarget {
  /** The notify service name after `notify.`, e.g. mobile_app_alex_iphone or a notify group. */
  service: string;
  description?: string;
}

export const NOTIFY_INTERRUPTION_LEVELS = ["passive", "active", "time-sensitive"] as const;
export const DEFAULT_NOTIFY_URL_SCHEMES = ["hassonic"];
export const NOTIFY_TITLE_MAX = 100;
export const NOTIFY_MESSAGE_MAX = 1000;

const NOTIFY_SERVICE_RE = /^[a-z0-9_]+$/;

/**
 * Parse `notifyTargets` from plugin config. The CLI passes config from env vars as
 * strings, so a JSON string is accepted too.
 */
export function parseNotifyTargets(raw: unknown): Record<string, NotifyTarget> {
  let value = raw;
  if (typeof value === "string") {
    if (!value.trim()) return {};
    try { value = JSON.parse(value); } catch { throw new Error("notifyTargets is not valid JSON."); }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const targets: Record<string, NotifyTarget> = {};
  for (const [name, t] of Object.entries(value as Record<string, unknown>)) {
    const service = (t as { service?: unknown } | null)?.service;
    if (typeof service !== "string" || !service.trim()) continue;
    const description = (t as { description?: unknown }).description;
    targets[name] = { service: service.trim(), ...(typeof description === "string" ? { description } : {}) };
  }
  return targets;
}

/** Parse `notifyUrlSchemes`: an array, or a comma-separated string from the CLI. Defaults to hassonic. */
export function parseNotifyUrlSchemes(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const schemes = list.map((s) => String(s).trim().toLowerCase().replace(/:\/*$/, "")).filter(Boolean);
  return schemes.length ? schemes : DEFAULT_NOTIFY_URL_SCHEMES;
}

/** Strip the server URL, host, and token from an error so the agent never sees them. */
function redactServer(message: string, config: HomeAssistantConfig): string {
  const secrets = [config.server, config.token];
  try {
    const u = new URL(config.server);
    secrets.push(u.host, u.hostname);
  } catch { /* not a URL; the raw value is still redacted */ }
  let out = message;
  for (const s of secrets.filter((s) => s && s.length > 2).sort((a, b) => b.length - a.length)) {
    out = out.split(s).join("<home-assistant>");
  }
  return out;
}

export async function notify(
  config: HomeAssistantConfig,
  params: { target: string; message: string; title?: string; url?: string; interruptionLevel?: string },
  options: { targets: Record<string, NotifyTarget>; urlSchemes: string[] },
): Promise<unknown> {
  const names = Object.keys(options.targets);
  if (names.length === 0) {
    return { error: "No notify targets are configured. Add `notifyTargets` to the Home Assistant plugin config." };
  }
  // Exact key match only: no free-form service names.
  const targetName = params.target ?? "";
  const target = Object.prototype.hasOwnProperty.call(options.targets, targetName) ? options.targets[targetName] : undefined;
  if (!target) return { error: `Unknown notify target "${targetName}". Allowed targets: ${names.join(", ")}.` };
  if (!NOTIFY_SERVICE_RE.test(target.service)) {
    return { error: `Notify target "${targetName}" has an invalid service in config; use the name after "notify." (e.g. mobile_app_alex_iphone).` };
  }

  const message = params.message?.trim() ?? "";
  if (!message) return { error: "message is required" };
  if (message.length > NOTIFY_MESSAGE_MAX) return { error: `message is too long (${message.length} chars; max ${NOTIFY_MESSAGE_MAX})` };
  const title = params.title?.trim() || undefined;
  if (title && title.length > NOTIFY_TITLE_MAX) return { error: `title is too long (${title.length} chars; max ${NOTIFY_TITLE_MAX})` };

  const level = params.interruptionLevel?.trim() || undefined;
  if (level && !(NOTIFY_INTERRUPTION_LEVELS as readonly string[]).includes(level)) {
    return { error: `interruptionLevel must be one of: ${NOTIFY_INTERRUPTION_LEVELS.join(", ")}` };
  }

  const url = params.url?.trim() || undefined;
  if (url) {
    let scheme = "";
    try { scheme = new URL(url).protocol.replace(/:$/, "").toLowerCase(); } catch { /* reported below */ }
    if (!scheme) return { error: "url is not a valid URL" };
    if (!options.urlSchemes.includes(scheme)) {
      return { error: `url scheme "${scheme}:" is not allowed. Allowed schemes: ${options.urlSchemes.map((s) => `${s}:`).join(", ")}` };
    }
  }

  const data: Record<string, unknown> = {};
  if (url) data.url = url;
  if (level) data.push = { "interruption-level": level };
  const body: Record<string, unknown> = { message };
  if (title) body.title = title;
  if (Object.keys(data).length) body.data = data;

  const res = await apiPost(config.server, config.token, `/api/services/notify/${target.service}`, body, 15_000);
  if ("error" in res) return { error: `Notification to "${targetName}" failed: ${redactServer(res.error, config)}` };
  return { ok: true, target: targetName };
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

/** Folders a collage keyframe may come from: OpenClaw's media store and the capture dir. */
export function keyframeAllowed(file: string, captureDir: string, home = process.env.HOME ?? ""): boolean {
  const real = (() => {
    try {
      return fs.realpathSync(file);
    } catch {
      return "";
    }
  })();
  if (!real) return false;
  const roots = [captureDir, home && path.join(home, ".openclaw", "media")].filter(Boolean).map((r) => {
    try {
      return fs.realpathSync(r);
    } catch {
      return path.resolve(r);
    }
  });
  return roots.some((r) => real === r || real.startsWith(r + path.sep));
}

/**
 * ffmpeg filter for a grid of `names` (inputs 0..n-1), optionally with input n
 * (the keyframe) scaled to the grid's width and stacked on top.
 */
export function buildCollageFilter(names: string[], opts: { labels: boolean; keyframe: boolean }): string {
  const n = names.length;
  const cols = Math.ceil(Math.sqrt(n));
  const scaleW = 640, scaleH = 360;
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    let f = `[${i}:v]scale=${scaleW}:${scaleH}:force_original_aspect_ratio=decrease,pad=${scaleW}:${scaleH}:(ow-iw)/2:(oh-ih)/2`;
    if (opts.labels) {
      f += `,drawtext=text='${names[i]}':fontsize=18:fontcolor=white:x=10:y=h-th-10:box=1:boxcolor=black@0.5:boxborderw=4`;
    }
    parts.push(`${f}[v${i}]`);
  }
  const gridOut = opts.keyframe ? "grid" : "out";
  if (n === 1) {
    parts.push(`[v0]null[${gridOut}]`);
  } else {
    const layout = Array.from({ length: n }, (_, i) => {
      const row = Math.floor(i / cols), col = i % cols;
      return `${col > 0 ? col * scaleW : 0}_${row > 0 ? row * scaleH : 0}`;
    }).join("|");
    // Pad the grid to full rows so the keyframe above lines up with it.
    const rows = Math.ceil(n / cols);
    const fill = n % cols === 0 ? "" : `:fill=black`;
    parts.push(`${Array.from({ length: n }, (_, i) => `[v${i}]`).join("")}xstack=inputs=${n}:layout=${layout}${fill},pad=${cols * scaleW}:${rows * scaleH}[${gridOut}]`);
  }
  if (opts.keyframe) {
    const width = n === 1 ? scaleW : cols * scaleW;
    parts.push(`[${n}:v]scale=${width}:-2[key]`);
    parts.push(`[key][grid]vstack=inputs=2[out]`);
  }
  return parts.join(";");
}

export async function cameraCollageHandler(
  config: HomeAssistantConfig,
  params: { camera_names?: string[]; label?: boolean; keyframe?: string },
): Promise<unknown> {
  const { server, token, captureDir } = config;
  const requestedNames = params.camera_names ?? DEFAULT_COLLAGE_CAMERAS;
  // The cameras stamp their own name and time on each frame, so labels are opt-in.
  const drawLabel = params.label === true;
  const keyframe = params.keyframe?.trim() || undefined;
  if (keyframe && !keyframeAllowed(keyframe, captureDir)) {
    return { error: "keyframe must be an existing image under ~/.openclaw/media or the capture folder" };
  }

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

  const names = snapshots.map(([name]) => name);
  const buildFilter = (withLabels: boolean): string => buildCollageFilter(names, { labels: withLabels, keyframe: Boolean(keyframe) });

  const ts = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  fs.mkdirSync(captureDir, { recursive: true });
  const outPath = path.join(captureDir, `collage_${ts}.jpg`);

  const runFfmpeg = (withLabels: boolean) => {
    const args = ["-y"];
    for (const [, file] of snapshots) args.push("-i", file);
    if (keyframe) args.push("-i", keyframe);
    args.push("-filter_complex", buildFilter(withLabels), "-map", "[out]", "-frames:v", "1", "-update", "1", "-q:v", "3", outPath);
    return execFileAsync("ffmpeg", args, { timeout: 30_000 });
  };

  let labeled = drawLabel;
  try {
    try {
      await runFfmpeg(labeled);
    } catch (e: unknown) {
      // Homebrew's ffmpeg is built without freetype, so it has no drawtext filter.
      // A collage without camera names beats no collage.
      if (!labeled || !String((e as { stderr?: string }).stderr ?? "").includes("drawtext")) throw e;
      labeled = false;
      await runFfmpeg(false);
    }
  } catch (e: unknown) {
    const err = e as { stderr?: string; message?: string };
    // stderr is "" when ffmpeg never started (e.g. ENOENT), so fall through to the message
    return { error: "ffmpeg error", detail: (err.stderr || err.message || String(e)).slice(-500) };
  }

  const sizeKb = Math.round(fs.statSync(outPath).size / 1024);
  return {
    file: outPath,
    cameras: snapshots.map(([n]) => n),
    ...(keyframe ? { keyframe } : {}),
    size_kb: sizeKb,
    ...(drawLabel && !labeled ? { note: "labels skipped: this ffmpeg has no drawtext filter" } : {}),
    ...(failed.length ? { failed } : {}),
  };
}
