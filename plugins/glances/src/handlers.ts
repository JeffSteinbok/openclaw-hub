/**
 * Glances — core handlers.
 *
 * Pure logic with no knowledge of how it's invoked (plugin vs CLI).
 * Config is passed in; handlers never read env vars or plugin APIs directly.
 */

import https from "node:https";
import http from "node:http";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GlancesConfig {
  url: string;
}

export interface FsEntry {
  mnt_point?: string;
  device_name?: string;
  fs_type?: string;
  percent?: number;
  used?: number;
  free?: number;
  size?: number;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

export function httpGet(url: string, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { headers: { Accept: "application/json" }, timeout: timeoutMs }, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 500)}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}

// ---------------------------------------------------------------------------
// Glances API client
// ---------------------------------------------------------------------------

export function normalizeBaseUrl(url: string): string {
  let s = (url ?? "").trim();
  while (s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

export async function apiGet(
  baseUrl: string,
  path: string,
  timeoutMs = 10_000,
): Promise<{ output: unknown } | { error: string; url: string }> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${normalizeBaseUrl(baseUrl)}${normalizedPath}`;
  try {
    const raw = await httpGet(url, timeoutMs);
    return { output: JSON.parse(raw) };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg, url };
  }
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

export function bytesToGib(value: unknown): number | null {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (isNaN(n)) return null;
  return Math.round((n / 1024 ** 3) * 100) / 100;
}

export function selectFsEntry(entries: unknown, mountPoint: string, fallbackFirst: boolean): FsEntry | null {
  if (!Array.isArray(entries)) return null;
  if (mountPoint) {
    const found = (entries as FsEntry[]).find((e) => e.mnt_point === mountPoint);
    if (found) return found;
  }
  if (fallbackFirst) return (entries as FsEntry[])[0] ?? null;
  return null;
}

export function shapeDisk(entry: FsEntry | null): unknown {
  if (!entry) return null;
  return {
    mount_point: entry.mnt_point ?? null,
    device_name: entry.device_name ?? null,
    fs_type: entry.fs_type ?? null,
    percent_used: entry.percent ?? null,
    used_bytes: entry.used ?? null,
    used_gib: bytesToGib(entry.used),
    free_bytes: entry.free ?? null,
    free_gib: bytesToGib(entry.free),
    size_bytes: entry.size ?? null,
    size_gib: bytesToGib(entry.size),
  };
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

export async function handleSummaryGet(baseUrl: string, mountPoint: string): Promise<unknown> {
  const [quicklookRes, fsRes, uptimeRes] = await Promise.all([
    apiGet(baseUrl, "/api/3/quicklook"),
    apiGet(baseUrl, "/api/3/fs"),
    apiGet(baseUrl, "/api/3/uptime"),
  ]);

  for (const res of [quicklookRes, fsRes, uptimeRes]) {
    if ("error" in res) return res;
  }

  const quicklook = (quicklookRes as { output: Record<string, unknown> }).output;
  const fsEntries = (fsRes as { output: unknown }).output;
  const uptime = (uptimeRes as { output: unknown }).output;

  const fsEntry = selectFsEntry(fsEntries, mountPoint, false);
  if (mountPoint && fsEntry === null) {
    return { error: `No filesystem found for mount_point '${mountPoint}'` };
  }

  return {
    output: {
      cpu_percent: quicklook.cpu ?? null,
      memory_percent: quicklook.mem ?? null,
      swap_percent: quicklook.swap ?? null,
      cpu_name: quicklook.cpu_name ?? null,
      uptime,
      disk: shapeDisk(fsEntry),
      source_url: normalizeBaseUrl(baseUrl),
    },
  };
}

export async function handleCpuGet(baseUrl: string, includePercpu: boolean): Promise<unknown> {
  const cpuRes = await apiGet(baseUrl, "/api/3/cpu");
  if ("error" in cpuRes) return cpuRes;

  const output = { ...(cpuRes as { output: Record<string, unknown> }).output };

  if (includePercpu) {
    const quicklookRes = await apiGet(baseUrl, "/api/3/quicklook");
    if ("error" in quicklookRes) return quicklookRes;
    const ql = (quicklookRes as { output: Record<string, unknown> }).output;
    output.percpu = ql.percpu ?? [];
  }

  return { output };
}

export async function handleMemoryGet(baseUrl: string): Promise<unknown> {
  const result = await apiGet(baseUrl, "/api/3/mem");
  if ("error" in result) return result;

  const mem = (result as { output: Record<string, unknown> }).output;
  return {
    output: {
      percent_used: mem.percent ?? null,
      used_bytes: mem.used ?? null,
      used_gib: bytesToGib(mem.used),
      available_bytes: mem.available ?? null,
      available_gib: bytesToGib(mem.available),
      free_bytes: mem.free ?? null,
      free_gib: bytesToGib(mem.free),
      total_bytes: mem.total ?? null,
      total_gib: bytesToGib(mem.total),
    },
  };
}

export async function handleDiskGet(baseUrl: string, mountPoint: string): Promise<unknown> {
  const result = await apiGet(baseUrl, "/api/3/fs");
  if ("error" in result) return result;

  const entries = (result as { output: unknown }).output;
  const entry = selectFsEntry(entries, mountPoint, false);
  if (entry === null) {
    return { error: `No filesystem found for mount_point '${mountPoint}'` };
  }
  return { output: shapeDisk(entry) };
}

export async function handleEndpointGet(baseUrl: string, path: string): Promise<unknown> {
  if (!path) return { error: "path is required" };
  if (!path.startsWith("/api/3/")) return { error: "path must start with /api/3/" };
  return apiGet(baseUrl, path, 20_000);
}
