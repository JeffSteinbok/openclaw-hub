/**
 * LLM Vision plugin — thin shim delegating to handlers.ts.
 */

import { definePlugin } from "carapace-plugin-sdk";
import { Type } from "@sinclair/typebox";
import {
  type LlmVisionConfig, VALID_LABELS,
  timelineGet, getImage, analyzeImage, createEvent,
} from "./handlers.js";

function stripTrailingSlashes(s: string): string {
  while (s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

export const createEntry = definePlugin({
  id: "llmvision",
  name: "Home Assistant – LLM Vision",
  description: "Home Assistant LLM Vision integration: analyze camera images with AI, query the vision timeline, and create timeline events.",

  configSchema: Type.Object({
    server: Type.Optional(Type.String({ description: "Home Assistant server URL" })),
    token: Type.Optional(Type.String({ description: "Home Assistant long-lived access token" })),
    keyframeDir: Type.Optional(Type.String({ description: "Directory where downloaded keyframes are stored" })),
  }),

  tools: (tool) => [
    tool({
      name: "llmvision_timeline_get",
      label: "LLM Vision Timeline",
      description: "Get events from the LLM Vision timeline. Returns AI-generated observation events with timestamps, summaries, and descriptions.",
      parameters: Type.Object({
        days: Type.Optional(Type.Number({ description: "Number of days to look back (default: 7)." })),
        limit: Type.Optional(Type.Integer({ description: "Maximum number of events to return (default: 50, max: 200)." })),
        start_time: Type.Optional(Type.String({ description: "Start of query window as ISO 8601." })),
        end_time: Type.Optional(Type.String({ description: "End of query window as ISO 8601. Defaults to now." })),
      }),
      async execute({ days, limit, start_time, end_time }, config) {
        try {
          const pluginConfig: LlmVisionConfig = {
            server: stripTrailingSlashes(config.server?.trim() || "") || "http://192.168.1.76:8123",
            token: config.token ?? "",
            keyframeDir: config.keyframeDir?.trim() || "/tmp/openclaw/llmvision_keyframes",
          };
          return await timelineGet(pluginConfig, { days, limit, start_time, end_time });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "llmvision_get_image",
      label: "LLM Vision Get Image",
      description: "Download a keyframe image from HA LLM Vision media storage. Pass a key_frame path from a timeline event. Returns the local file path.",
      parameters: Type.Object({ key_frame: Type.String({ description: "The key_frame path (e.g. /media/llmvision/snapshots/abc123-camera0.jpg)." }) }),
      async execute({ key_frame }, config) {
        try {
          const pluginConfig: LlmVisionConfig = {
            server: stripTrailingSlashes(config.server?.trim() || "") || "http://192.168.1.76:8123",
            token: config.token ?? "",
            keyframeDir: config.keyframeDir?.trim() || "/tmp/openclaw/llmvision_keyframes",
          };
          return await getImage(pluginConfig, { key_frame });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "llmvision_analyze_image",
      label: "LLM Vision Analyze",
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
      async execute({ camera_entity, message, provider, model, store_in_timeline, expose_images, generate_title, response_format, max_tokens }, config) {
        try {
          const pluginConfig: LlmVisionConfig = {
            server: stripTrailingSlashes(config.server?.trim() || "") || "http://192.168.1.76:8123",
            token: config.token ?? "",
            keyframeDir: config.keyframeDir?.trim() || "/tmp/openclaw/llmvision_keyframes",
          };
          return await analyzeImage(pluginConfig, {
            camera_entity,
            message,
            provider,
            model,
            store_in_timeline,
            expose_images,
            generate_title,
            response_format,
            max_tokens,
          });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "llmvision_create_event",
      label: "LLM Vision Create Event",
      description: "Create a new event in the LLM Vision timeline.",
      parameters: Type.Object({
        title: Type.String({ description: "Title of the timeline event." }),
        description: Type.String({ description: "Detailed description or AI summary for the event." }),
        label: Type.Optional(Type.Union(VALID_LABELS.map((label) => Type.Literal(label)) as [ReturnType<typeof Type.Literal>, ...ReturnType<typeof Type.Literal>[]], { description: "Optional category label (e.g. 'Person', 'Car')." })),
        image_path: Type.Optional(Type.String({ description: "Optional path to an image file to attach." })),
        camera_entity: Type.Optional(Type.String({ description: "Optional camera entity ID to capture an image from." })),
        start_time: Type.Optional(Type.String({ description: "Event start time as ISO 8601 (defaults to now)." })),
        end_time: Type.Optional(Type.String({ description: "Event end time as ISO 8601 (defaults to start_time)." })),
      }),
      async execute({ title, description, label, image_path, camera_entity, start_time, end_time }, config) {
        try {
          const pluginConfig: LlmVisionConfig = {
            server: stripTrailingSlashes(config.server?.trim() || "") || "http://192.168.1.76:8123",
            token: config.token ?? "",
            keyframeDir: config.keyframeDir?.trim() || "/tmp/openclaw/llmvision_keyframes",
          };
          return await createEvent(pluginConfig, {
            title,
            description,
            label,
            image_path,
            camera_entity,
            start_time,
            end_time,
          });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),
  ],
});
