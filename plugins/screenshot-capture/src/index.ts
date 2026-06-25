/**
 * screenshot-capture — OpenClaw plugin.
 *
 * Wraps `openclaw nodes invoke screen.snapshot`, intercepts the base64 response,
 * writes it to disk, and returns { file } for gateway mediaId conversion.
 */

import { definePlugin } from "carapace-plugin-sdk";
import { Type } from "@sinclair/typebox";
import { screenshotCapture, type ScreenshotConfig } from "./handlers.js";

export const createEntry = definePlugin({
  id: "screenshot-capture",
  name: "Screenshot Capture",
  description:
    "Capture screenshots from paired nodes. Decodes the base64 response and writes to disk, " +
    "returning a file path the gateway converts to a mediaId.",
  contracts: { tools: ["screenshot_capture"] },

  configSchema: Type.Object({
    outDir: Type.Optional(
      Type.String({
        description: "Directory where screenshots are written (default: /tmp/openclaw/screenshots)",
        default: "/tmp/openclaw/screenshots",
      }),
    ),
    openclawBin: Type.Optional(
      Type.String({
        description: "Path to the openclaw binary (default: openclaw)",
        default: "openclaw",
      }),
    ),
    gatewayUrl: Type.Optional(
      Type.String({
        description: "Gateway WebSocket URL (optional, uses default gateway config if omitted)",
      }),
    ),
    gatewayToken: Type.Optional(
      Type.String({
        description: "Gateway auth token (optional, uses default gateway config if omitted)",
      }),
    ),
    invokeTimeout: Type.Optional(
      Type.Number({
        description: "Timeout in ms for the node invoke call (default: 30000)",
        default: 30000,
      }),
    ),
  }),

  tools: (tool) => [
    tool({
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
          }),
        ),
        quality: Type.Optional(
          Type.Number({
            description: "JPEG quality 1–100 (ignored for PNG, default: 90)",
            default: 90,
            minimum: 1,
            maximum: 100,
          }),
        ),
        format: Type.Optional(
          Type.String({
            description: 'Image format: "png" (default) or "jpeg"',
            default: "png",
            enum: ["png", "jpeg"],
          }),
        ),
      }),
      async execute({ node, screenIndex, quality, format }, config) {
        try {
          const resolvedConfig: ScreenshotConfig = {
            outDir: config.outDir?.trim() || "/tmp/openclaw/screenshots",
            openclawBin: config.openclawBin?.trim() || "openclaw",
            gatewayUrl: config.gatewayUrl || undefined,
            gatewayToken: config.gatewayToken || undefined,
            invokeTimeout: Number(config.invokeTimeout) || 30000,
          };
          return await screenshotCapture(resolvedConfig, {
            node: String(node ?? ""),
            screenIndex: screenIndex != null ? Number(screenIndex) : undefined,
            quality: quality != null ? Number(quality) : undefined,
            format,
          });
        } catch (e: unknown) {
          return {
            error: e instanceof Error ? e.message : String(e),
          };
        }
      },
    }),
  ],
});
