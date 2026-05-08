/**
 * LLM Vision handlers — pure business logic, no plugin SDK or typebox imports.
 */

import fs from "node:fs";
import https from "node:https";
import http from "node:http";
import path from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface LlmVisionConfig {
  server: string;
  token: string;
  keyframeDir: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const VALID_LABELS = ["Alarm", "Bike", "Bird", "Bus", "Camera", "Car", "Cat", "Dog", "Door", "Key", "Light", "Lock", "Motorcycle", "Package", "Person", "Plant", "Sensor", "Tree", "Truck", "Van"] as const;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpRequest(method: "GET" | "POST", url: string, headers: Record<string, string>, body?: string, ms = 20_000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.request(url, { method, headers, timeout: ms }, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    if (body) req.write(body);
    req.end();
  });
}

function httpRequestBinary(url: string, headers: Record<string, string>, ms = 20_000): Promise<{ status: number; buffer: Buffer }> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.request(url, { method: "GET", headers, timeout: ms }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, buffer: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

export async function haGet(server: string, token: string, apiPath: string, params?: Record<string, string | number>) {
  let url = `${server}${apiPath}`;
  if (params) url += "?" + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  const res = await httpRequest("GET", url, { Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
  if (res.status < 200 || res.status >= 300) return { error: `HTTP ${res.status}: ${res.body.slice(0, 500)}` };
  return { output: JSON.parse(res.body) };
}

export async function haPost(server: string, token: string, apiPath: string, body: unknown) {
  const res = await httpRequest("POST", `${server}${apiPath}`, { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, JSON.stringify(body), 30_000);
  if (res.status < 200 || res.status >= 300) return { error: `HTTP ${res.status}: ${res.body.slice(0, 500)}` };
  return { output: JSON.parse(res.body) };
}

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function timelineGet(config: LlmVisionConfig, params: { days?: number; limit?: number; start_time?: string; end_time?: string }): Promise<unknown> {
  const { server, token } = config;
  const days = params.days ?? 7;
  const limit = Math.min(params.limit ?? 50, 200);
  const res = await haGet(server, token, "/api/llmvision/timeline/events", { limit });
  if ("error" in res) return res;
  const raw = ((res.output as Record<string, unknown>).events as Array<Record<string, unknown>>) ?? [];
  const now = Date.now();
  const startDt = params.start_time ? new Date(params.start_time).getTime() : now - days * 86400000;
  const endDt = params.end_time ? new Date(params.end_time).getTime() : now;
  const events = raw.filter((e) => {
    try { const t = new Date((e.start ?? e.when ?? "") as string).getTime(); return t >= startDt && t <= endDt; } catch { return true; }
  }).map((e) => ({
    title: e.title ?? "", description: e.description ?? "", uid: e.uid ?? "",
    label: e.label ?? e.category ?? "", camera: e.camera_name ?? "",
    key_frame: e.key_frame ?? "", start: e.start ?? "", end: e.end ?? "",
  })).sort((a, b) => (b.start as string).localeCompare(a.start as string)).slice(0, limit);
  return { count: events.length, events };
}

export async function getImage(config: LlmVisionConfig, params: { key_frame: string }): Promise<unknown> {
  const { server, token, keyframeDir } = config;
  const kf = params.key_frame.trim();
  if (!kf) return { error: "key_frame is required" };
  const haPath = kf.startsWith("/media/") ? "/media/local" + kf.slice(6) : kf;
  const res = await httpRequestBinary(`${server}${haPath}`, { Authorization: `Bearer ${token}` }, 15_000);
  if (res.status < 200 || res.status >= 300) return { error: `HTTP ${res.status}` };
  const buf = res.buffer;
  if (buf.length < 3 || buf[0] !== 0xff || buf[1] !== 0xd8) return { error: "Response is not a valid JPEG" };
  fs.mkdirSync(keyframeDir, { recursive: true });
  const filename = kf.split("/").pop()!;
  const localPath = path.join(keyframeDir, filename);
  fs.writeFileSync(localPath, buf);
  return { file: localPath, size_kb: Math.round(buf.length / 1024) };
}

export async function analyzeImage(config: LlmVisionConfig, params: {
  camera_entity: string; message: string; provider: string;
  model?: string; store_in_timeline?: boolean; expose_images?: boolean;
  generate_title?: boolean; response_format?: string; max_tokens?: number;
}): Promise<unknown> {
  const { server, token } = config;
  if (!params.camera_entity) return { error: "camera_entity is required" };
  if (!params.message) return { error: "message is required" };
  if (!params.provider) return { error: "provider is required" };
  const body: Record<string, unknown> = { entity_id: params.camera_entity, message: params.message, provider: params.provider };
  if (params.model) body.model = params.model;
  if (params.store_in_timeline !== undefined) body.store_in_timeline = params.store_in_timeline;
  if (params.expose_images !== undefined) body.expose_images = params.expose_images;
  if (params.generate_title !== undefined) body.generate_title = params.generate_title;
  if (params.response_format) body.response_format = params.response_format;
  if (params.max_tokens) body.max_tokens = params.max_tokens;
  const res = await haPost(server, token, "/api/services/llmvision/image_analyzer", body);
  if ("error" in res) return res;
  return { result: res.output };
}

export async function createEvent(config: LlmVisionConfig, params: {
  title: string; description: string; label?: string;
  image_path?: string; camera_entity?: string; start_time?: string; end_time?: string;
}): Promise<unknown> {
  const { server, token } = config;
  if (!params.title) return { error: "title is required" };
  if (!params.description) return { error: "description is required" };
  if (params.label && !VALID_LABELS.includes(params.label as typeof VALID_LABELS[number])) {
    return { error: `Invalid label '${params.label}'` };
  }
  const body: Record<string, unknown> = { title: params.title, description: params.description };
  if (params.label) body.label = params.label;
  if (params.image_path) body.image_path = params.image_path;
  if (params.camera_entity) body.entity_id = params.camera_entity;
  if (params.start_time) body.start_time = params.start_time;
  if (params.end_time) body.end_time = params.end_time;
  const res = await haPost(server, token, "/api/services/llmvision/create_event", body);
  if ("error" in res) return res;
  return { result: res.output };
}
