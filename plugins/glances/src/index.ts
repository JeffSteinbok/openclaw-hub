/**
 * Glances plugin — OpenClaw plugin shim.
 *
 * Constructs config from pluginConfig, registers tools that delegate to handlers.
 */

import { Type } from "@sinclair/typebox";
import {
  handleSummaryGet,
  handleCpuGet,
  handleMemoryGet,
  handleDiskGet,
  handleEndpointGet,
  type GlancesConfig,
} from "./handlers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PluginApi = {
  registerTool: (tool: unknown) => void;
  pluginConfig?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data) }],
    details: {},
  };
}

function buildConfig(pluginConfig?: Record<string, unknown>): GlancesConfig {
  return {
    url: ((pluginConfig?.url as string) ?? "").trim() || "http://127.0.0.1:61208",
  };
}

// ---------------------------------------------------------------------------
// Plugin entry
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

function createEntry() {
  return {
    id: "glances",
    name: "Glances",
    description: "Read CPU, memory, disk, and summary metrics from a Glances server",
    contracts: { tools: ["glances_summary_get", "glances_cpu_get", "glances_memory_get", "glances_disk_get", "glances_endpoint_get"] },
    configSchema,
    register(api: PluginApi) {
      const config = buildConfig(api.pluginConfig);

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
          return formatResult(await handleSummaryGet(config.url, mountPoint));
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
          return formatResult(await handleCpuGet(config.url, includePercpu));
        },
      });

      api.registerTool({
        name: "glances_memory_get",
        label: "Glances Memory",
        description: "Get current memory usage metrics from Glances.",
        parameters: Type.Object({}),
        async execute(_toolCallId: string, _params: Record<string, unknown>) {
          return formatResult(await handleMemoryGet(config.url));
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
          return formatResult(await handleDiskGet(config.url, mountPoint));
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
          return formatResult(await handleEndpointGet(config.url, path));
        },
      });
    },
  };
}

export { createEntry };
