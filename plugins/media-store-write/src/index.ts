/**
 * media-store-write — OpenClaw plugin.
 *
 * Decodes base64-encoded bytes and writes them to the gateway media store,
 * returning a file path that OpenClaw converts to a mediaId.
 *
 * ## Problem solved
 *
 * When `nodes(action="invoke", invokeCommand="screen.snapshot")` returns a
 * screenshot, the payload contains raw base64 PNG data. There is no way for
 * the agent to attach this directly to a Discord/Telegram message — the
 * `message` tool only accepts URLs or gateway media IDs.
 *
 * The `hass_camera_snapshot` tool works fine because it writes a file and
 * returns `{ file: "/path/..." }`. OpenClaw gateway picks up `file` keys in
 * tool results and converts them to media IDs. This plugin does the same for
 * any base64 payload.
 *
 * ## Usage
 *
 * ```
 * const result = await media_write({ base64: "...", mimeType: "image/png" });
 * // result.file  → absolute path, auto-converted to mediaId by the gateway
 * ```
 */

import { Type } from "@sinclair/typebox";
import { handleMediaWrite } from "./handlers.js";

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

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

/** Default directory for written media files. */
const DEFAULT_MEDIA_DIR = "/tmp/openclaw/media_store";

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    mediaDir: {
      type: "string" as const,
      description:
        "Directory where media files are written (default: /tmp/openclaw/media_store).",
      default: DEFAULT_MEDIA_DIR,
    },
  },
};

function buildMediaDir(pluginConfig?: Record<string, unknown>): string {
  return (
    ((pluginConfig?.mediaDir as string) ?? "").trim() || DEFAULT_MEDIA_DIR
  );
}

function createEntry() {
  return {
    id: "media-store-write",
    name: "Media Store Write",
    description:
      "Decode base64 bytes and write them to the gateway media store. Returns a file path the gateway converts to a mediaId for attaching to messages.",
    contracts: { tools: ["media_write"] },
    configSchema,
    register(api: PluginApi) {
      const mediaDir = buildMediaDir(api.pluginConfig);

      api.registerTool({
        name: "media_write",
        label: "Media Write",
        description: [
          "Store a file in the gateway media store so it can be attached to messages.",
          "Returns { file, mediaId, size_bytes, mimeType } — the `file` field is automatically",
          "converted to a gateway mediaId by OpenClaw and can be passed to the `message` tool's",
          "`media` or `attachments` parameter.",
          "",
          "Accepts EITHER file_path (preferred for large files like screenshots) OR base64.",
          "When using file_path, mimeType is auto-detected from the extension if not provided.",
        ].join("\n"),
        parameters: Type.Object({
          file_path: Type.Optional(
            Type.String({
              description:
                "Absolute path to an existing file to store (e.g. from screen.snapshot out-path). " +
                "Preferred over base64 for large files. MIME type is auto-detected from extension.",
            })
          ),
          base64: Type.Optional(
            Type.String({
              description:
                "Base64-encoded file content. Standard or URL-safe encoding; padding optional. " +
                "Use file_path instead for large payloads like screenshots.",
            })
          ),
          mimeType: Type.Optional(
            Type.String({
              description:
                'MIME type of the content, e.g. "image/png", "image/jpeg". ' +
                "Required for base64 mode; auto-detected from extension for file_path mode.",
            })
          ),
          filename: Type.Optional(
            Type.String({
              description:
                "Hint for the stored filename (basename only; no path traversal). " +
                "A timestamp suffix is always appended. Defaults to source filename or \"media\".",
            })
          ),
        }),
        async execute(_id: string, params: Record<string, unknown>) {
          try {
            return formatResult(
              await handleMediaWrite(mediaDir, {
                file_path: params.file_path as string | undefined,
                base64: params.base64 as string | undefined,
                mimeType: params.mimeType as string | undefined,
                filename: params.filename as string | undefined,
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
