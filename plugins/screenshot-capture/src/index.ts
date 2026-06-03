/**
 * screenshot-capture — OpenClaw plugin.
 *
 * Wraps `openclaw nodes invoke screen.snapshot`, intercepts the base64 response,
 * writes it to disk, and returns { file } for gateway mediaId conversion.
 */

import { Type } from "@sinclair/typebox";
import { screenshotCapture, type ScreenshotConfig } from "./handlers.js";

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
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data),
      },
    ],
    details: {},
  };
}

function buildConfig(pluginConfig?: Record<string, unknown>): ScreenshotConfig {
  return {
    outDir: ((pluginConfig?.outDir as string) ?? "").trim() || "/tmp/openclaw/screenshots",
    openclawBin: ((pluginConfig?.openclawBin as string) ?? "").trim() || "openclaw",
    gatewayUrl: (pluginConfig?.gatewayUrl as string) || undefined,
    gatewayToken: (pluginConfig?.gatewayToken as string) || undefined,
    invokeTimeout: Number(pluginConfig?.invokeTimeout) || 30000,
  };
}

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    outDir: {
      type: "string" as const,
      description: "Directory where screenshots are written (default: /tmp/openclaw/screenshots)",
      default: "/tmp/openclaw/screenshots",
    },
    openclawBin: {
      type: "string" as const,
      description: "Path to the openclaw binary (default: openclaw)",
      default: "openclaw",
    },
    gatewayUrl: {
      type: "string" as const,
      description: "Gateway WebSocket URL (optional, uses default gateway config if omitted)",
    },
    gatewayToken: {
      type: "string" as const,
      description: "Gateway auth token (optional, uses default gateway config if omitted)",
    },
    invokeTimeout: {
      type: "number" as const,
      description: "Timeout in ms for the node invoke call (default: 30000)",
      default: 30000,
    },
  },
};

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

function createEntry() {
  return {
    id: "screenshot-capture",
    name: "Screenshot Capture",
    description:
      "Capture screenshots from paired nodes. Decodes the base64 response and writes to disk, " +
      "returning a file path the gateway converts to a mediaId.",
    contracts: { tools: ["screenshot_capture"] },
    configSchema,
    register(api: PluginApi) {
      const config = buildConfig(api.pluginConfig);

      api.registerTool({
        name: "screenshot_capture",
        label: "Screenshot Capture",
        description: [
          "Capture a screenshot from a paired node (e.g. a Windows companion).",
          "Returns { file, width, height, format, size_bytes, node } — the `file` field",
          "is automatically converted to a gateway mediaId by OpenClaw and can be passed",
          "to the `message` tool's `media` or `attachments` parameter.",
          "",
          "This avoids the ~1.3M token base64 blob from `nodes invoke screen.snapshot`",
          "by intercepting the response, writing to disk, and returning just the path.",
        ].join("\n"),
        parameters: Type.Object({
          node: Type.String({
            description:
              'Node id, name, or IP of the paired node (e.g. "Windows Node (JEFFOFFICE3)")',
          }),
          screenIndex: Type.Optional(
            Type.Number({
              description: "Which monitor to capture (default: 0 = primary)",
              default: 0,
              minimum: 0,
            })
          ),
          quality: Type.Optional(
            Type.Number({
              description: "JPEG quality 1–100 (ignored for PNG, default: 90)",
              default: 90,
              minimum: 1,
              maximum: 100,
            })
          ),
          format: Type.Optional(
            Type.String({
              description: 'Image format: "png" (default) or "jpeg"',
              default: "png",
              enum: ["png", "jpeg"],
            })
          ),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          try {
            return formatResult(
              await screenshotCapture(config, {
                node: String(params.node ?? ""),
                screenIndex: params.screenIndex != null ? Number(params.screenIndex) : undefined,
                quality: params.quality != null ? Number(params.quality) : undefined,
                format: params.format as "png" | "jpeg" | undefined,
              })
            );
          } catch (e: unknown) {
            return formatResult({
              error: e instanceof Error ? e.message : String(e),
            });
          }
        },
      });
    },
  };
}

export { createEntry };
