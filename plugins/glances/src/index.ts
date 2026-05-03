/**
 * Glances plugin — pure TS-native implementation.
 *
 * Reads CPU, memory, disk, and summary metrics from a Glances REST API server.
 */

import https from "node:https";
import http from "node:http";
import { Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PluginApi = {
  registerTool: (tool: unknown) => void;
  pluginConfig?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function httpGet(url: string, timeoutMs = 10_000): Promise<string> {
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

function normalizeBaseUrl(url: string): string {
  return (url ?? "").trim().replace(/\/+$/, "");
}

async function apiGet(
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

function bytesToGib(value: unknown): number | null {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (isNaN(n)) return null;
  return Math.round((n / 1024 ** 3) * 100) / 100;
}

interface FsEntry {
  mnt_point?: string;
  device_name?: string;
  fs_type?: string;
  percent?: number;
  used?: number;
  free?: number;
  size?: number;
}

function selectFsEntry(entries: unknown, mountPoint: string, fallbackFirst: boolean): FsEntry | null {
  if (!Array.isArray(entries)) return null;
  if (mountPoint) {
    const found = (entries as FsEntry[]).find((e) => e.mnt_point === mountPoint);
    if (found) return found;
  }
  if (fallbackFirst) return (entries as FsEntry[])[0] ?? null;
  return null;
}

function shapeDisk(entry: FsEntry | null): unknown {
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

async function handleSummaryGet(baseUrl: string, mountPoint: string): Promise<unknown> {
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

async function handleCpuGet(baseUrl: string, includePercpu: boolean): Promise<unknown> {
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

async function handleMemoryGet(baseUrl: string): Promise<unknown> {
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

async function handleDiskGet(baseUrl: string, mountPoint: string): Promise<unknown> {
  const result = await apiGet(baseUrl, "/api/3/fs");
  if ("error" in result) return result;

  const entries = (result as { output: unknown }).output;
  const entry = selectFsEntry(entries, mountPoint, false);
  if (entry === null) {
    return { error: `No filesystem found for mount_point '${mountPoint}'` };
  }
  return { output: shapeDisk(entry) };
}

async function handleEndpointGet(baseUrl: string, path: string): Promise<unknown> {
  if (!path) return { error: "path is required" };
  if (!path.startsWith("/api/3/")) return { error: "path must start with /api/3/" };
  return apiGet(baseUrl, path, 20_000);
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    url: {
      type: "string" as const,
      description: "Base URL for the Glances web server, e.g. http://127.0.0.1:61208",
      default: "http://127.0.0.1:61208",
    },
  },
};

function formatResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data) }],
    details: {},
  };
}

function createEntry() {
  return {
    id: "glances",
    name: "Glances",
    description: "Read CPU, memory, disk, and summary metrics from a Glances server",
    configSchema,
    register(api: PluginApi) {
      const getBaseUrl = () =>
        ((api.pluginConfig?.url as string) ?? "").trim() || "http://127.0.0.1:61208";

      api.registerTool({
        name: "glances_summary_get",
        label: "Glances Summary",
        description: "Get a compact Glances summary with CPU, memory, uptime, and one filesystem.",
        parameters: Type.Object({
          mount_point: Type.Optional(
            Type.String({
              description: "Filesystem mount point to summarize (default: /).",
              default: "/",
            }),
          ),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const mountPoint = ((params.mount_point as string) ?? "/").trim() || "/";
          return formatResult(await handleSummaryGet(getBaseUrl(), mountPoint));
        },
      });

      api.registerTool({
        name: "glances_cpu_get",
        label: "Glances CPU",
        description: "Get current CPU metrics from Glances.",
        parameters: Type.Object({
          include_percpu: Type.Optional(
            Type.Boolean({
              description: "Include per-core CPU usage from the quicklook endpoint.",
              default: false,
            }),
          ),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const includePercpu = Boolean(params.include_percpu);
          return formatResult(await handleCpuGet(getBaseUrl(), includePercpu));
        },
      });

      api.registerTool({
        name: "glances_memory_get",
        label: "Glances Memory",
        description: "Get current memory usage metrics from Glances.",
        parameters: Type.Object({}),
        async execute(_toolCallId: string, _params: Record<string, unknown>) {
          return formatResult(await handleMemoryGet(getBaseUrl()));
        },
      });

      api.registerTool({
        name: "glances_disk_get",
        label: "Glances Disk",
        description: "Get filesystem usage metrics for one mount point from Glances.",
        parameters: Type.Object({
          mount_point: Type.Optional(
            Type.String({
              description: "Filesystem mount point to query (default: /).",
              default: "/",
            }),
          ),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const mountPoint = ((params.mount_point as string) ?? "/").trim() || "/";
          return formatResult(await handleDiskGet(getBaseUrl(), mountPoint));
        },
      });

      api.registerTool({
        name: "glances_endpoint_get",
        label: "Glances Endpoint",
        description: "Fetch a raw JSON payload from a specific Glances /api/3 endpoint.",
        parameters: Type.Object({
          path: Type.String({
            description: "Glances API path beginning with /api/3/ (for example /api/3/uptime).",
          }),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const path = ((params.path as string) ?? "").trim();
          return formatResult(await handleEndpointGet(getBaseUrl(), path));
        },
      });
    },
  };
}

export { createEntry };
