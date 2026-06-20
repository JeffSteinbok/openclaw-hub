/**
 * Glances plugin — read CPU, memory, disk, and summary metrics from a Glances server.
 */

import { definePlugin } from "carapace-plugin-sdk";
import { Type } from "@sinclair/typebox";
import {
  handleSummaryGet,
  handleCpuGet,
  handleMemoryGet,
  handleDiskGet,
  handleEndpointGet,
} from "./handlers.js";

export const createEntry = definePlugin({
  id: "glances",
  name: "Glances",
  description: "Read CPU, memory, disk, and summary metrics from a Glances server",

  configSchema: Type.Object({
    url: Type.Optional(
      Type.String({
        description: "Base URL for the Glances web server, e.g. http://127.0.0.1:61208",
        default: "http://127.0.0.1:61208",
      }),
    ),
  }),

  tools: (tool) => [
    tool({
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
      async execute({ mount_point }, config) {
        const url = config.url?.trim() || "http://127.0.0.1:61208";
        const mountPoint = mount_point?.trim() || "/";
        return await handleSummaryGet(url, mountPoint);
      },
    }),

    tool({
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
      async execute({ include_percpu }, config) {
        const url = config.url?.trim() || "http://127.0.0.1:61208";
        return await handleCpuGet(url, Boolean(include_percpu));
      },
    }),

    tool({
      name: "glances_memory_get",
      label: "Glances Memory",
      description: "Get current memory usage metrics from Glances.",
      parameters: Type.Object({}),
      async execute(_params, config) {
        const url = config.url?.trim() || "http://127.0.0.1:61208";
        return await handleMemoryGet(url);
      },
    }),

    tool({
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
      async execute({ mount_point }, config) {
        const url = config.url?.trim() || "http://127.0.0.1:61208";
        const mountPoint = mount_point?.trim() || "/";
        return await handleDiskGet(url, mountPoint);
      },
    }),

    tool({
      name: "glances_endpoint_get",
      label: "Glances Endpoint",
      description: "Fetch a raw JSON payload from a specific Glances /api/3 endpoint.",
      parameters: Type.Object({
        path: Type.String({
          description: "Glances API path beginning with /api/3/ (for example /api/3/uptime).",
        }),
      }),
      async execute({ path }, config) {
        const url = config.url?.trim() || "http://127.0.0.1:61208";
        const trimmedPath = typeof path === "string" ? path.trim() : "";
        return await handleEndpointGet(url, trimmedPath);
      },
    }),
  ],
});
