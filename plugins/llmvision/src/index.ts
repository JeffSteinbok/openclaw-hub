/**
 * LLM Vision plugin — thin shim delegating to handlers.ts.
 */

import { Type } from "@sinclair/typebox";
import {
  type LlmVisionConfig, VALID_LABELS,
  timelineGet, getImage, analyzeImage, createEvent,
} from "./handlers.js";

type PluginApi = { registerTool: (t: unknown) => void; pluginConfig?: Record<string, unknown> };

function formatResult(data: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(data) }], details: {} }; }

const configSchema = { type: "object" as const, additionalProperties: false, properties: {
  server: { type: "string" as const, description: "Home Assistant server URL" },
  token: { type: "string" as const, description: "Home Assistant long-lived access token" },
}};

function buildConfig(pluginConfig?: Record<string, unknown>): LlmVisionConfig {
  return {
    server: ((pluginConfig?.server as string) ?? "").replace(/\/+$/, "") || "http://192.168.1.76:8123",
    token: (pluginConfig?.token as string) ?? "",
    keyframeDir: "/tmp/openclaw/llmvision_keyframes",
  };
}

export function createEntry() {
  return {
    id: "llmvision", name: "Home Assistant – LLM Vision",
    description: "Home Assistant LLM Vision integration: analyze camera images with AI, query the vision timeline, and create timeline events.",
    configSchema,
    register(api: PluginApi) {
      const cfg = () => buildConfig(api.pluginConfig);

      api.registerTool({ name: "llmvision_timeline_get", label: "LLM Vision Timeline",
        description: "Get events from the LLM Vision timeline. Returns AI-generated observation events with timestamps, summaries, and descriptions.",
        parameters: Type.Object({
          days: Type.Optional(Type.Number({ description: "Number of days to look back (default: 7)." })),
          limit: Type.Optional(Type.Integer({ description: "Maximum number of events to return (default: 50, max: 200)." })),
          start_time: Type.Optional(Type.String({ description: "Start of query window as ISO 8601." })),
          end_time: Type.Optional(Type.String({ description: "End of query window as ISO 8601. Defaults to now." })),
        }),
        async execute(_id: string, p: Record<string, unknown>) {
          try { return formatResult(await timelineGet(cfg(), { days: p.days as number | undefined, limit: p.limit as number | undefined, start_time: p.start_time as string | undefined, end_time: p.end_time as string | undefined })); }
          catch (e) { return formatResult({ error: (e as Error).message }); }
        },
      });

      api.registerTool({ name: "llmvision_get_image", label: "LLM Vision Get Image",
        description: "Download a keyframe image from HA LLM Vision media storage. Pass a key_frame path from a timeline event. Returns the local file path.",
        parameters: Type.Object({ key_frame: Type.String({ description: "The key_frame path (e.g. /media/llmvision/snapshots/abc123-camera0.jpg)." }) }),
        async execute(_id: string, p: Record<string, unknown>) {
          try { return formatResult(await getImage(cfg(), { key_frame: String(p.key_frame ?? "") })); }
          catch (e) { return formatResult({ error: (e as Error).message }); }
        },
      });

      api.registerTool({ name: "llmvision_analyze_image", label: "LLM Vision Analyze",
        description: "Trigger an AI image analysis on a Home Assistant camera entity using LLM Vision.",
        parameters: Type.Object({
          camera_entity: Type.String({ description: "Camera entity ID (e.g. camera.front_door)." }),
          message: Type.String({ description: "Prompt / question to send to the AI about the image." }),
          provider: Type.String({ description: "LLM Vision provider (e.g. 'anthropic', 'openai', 'ollama')." }),
          model: Type.Optional(Type.String({ description: "Specific model override." })),
          store_in_timeline: Type.Optional(Type.Boolean({ description: "Whether to save as a timeline event (default: false)." })),
          expose_images: Type.Optional(Type.Boolean({ description: "Whether to expose the captured image in the timeline event." })),
          generate_title: Type.Optional(Type.Boolean({ description: "Whether to auto-generate a title for the timeline event." })),
          response_format: Type.Optional(Type.Union([Type.Literal("text"), Type.Literal("json")], { description: "Response format: 'text' (default) or 'json'." })),
          max_tokens: Type.Optional(Type.Integer({ description: "Maximum tokens for the AI response." })),
        }),
        async execute(_id: string, p: Record<string, unknown>) {
          try {
            return formatResult(await analyzeImage(cfg(), {
              camera_entity: p.camera_entity as string,
              message: p.message as string,
              provider: p.provider as string,
              model: p.model as string | undefined,
              store_in_timeline: p.store_in_timeline as boolean | undefined,
              expose_images: p.expose_images as boolean | undefined,
              generate_title: p.generate_title as boolean | undefined,
              response_format: p.response_format as string | undefined,
              max_tokens: p.max_tokens as number | undefined,
            }));
          } catch (e) { return formatResult({ error: (e as Error).message }); }
        },
      });

      api.registerTool({ name: "llmvision_create_event", label: "LLM Vision Create Event",
        description: "Create a new event in the LLM Vision timeline.",
        parameters: Type.Object({
          title: Type.String({ description: "Title of the timeline event." }),
          description: Type.String({ description: "Detailed description or AI summary for the event." }),
          label: Type.Optional(Type.Union(VALID_LABELS.map(l => Type.Literal(l)) as [ReturnType<typeof Type.Literal>, ...ReturnType<typeof Type.Literal>[]], { description: "Optional category label (e.g. 'Person', 'Car')." })),
          image_path: Type.Optional(Type.String({ description: "Optional path to an image file to attach." })),
          camera_entity: Type.Optional(Type.String({ description: "Optional camera entity ID to capture an image from." })),
          start_time: Type.Optional(Type.String({ description: "Event start time as ISO 8601 (defaults to now)." })),
          end_time: Type.Optional(Type.String({ description: "Event end time as ISO 8601 (defaults to start_time)." })),
        }),
        async execute(_id: string, p: Record<string, unknown>) {
          try {
            return formatResult(await createEvent(cfg(), {
              title: p.title as string,
              description: p.description as string,
              label: p.label as string | undefined,
              image_path: p.image_path as string | undefined,
              camera_entity: p.camera_entity as string | undefined,
              start_time: p.start_time as string | undefined,
              end_time: p.end_time as string | undefined,
            }));
          } catch (e) { return formatResult({ error: (e as Error).message }); }
        },
      });
    },
  };
}
