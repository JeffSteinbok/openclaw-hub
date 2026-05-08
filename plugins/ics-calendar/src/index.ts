/**
 * ICS Calendar plugin — OpenClaw plugin shim.
 *
 * Constructs config from pluginConfig, registers tools that delegate to handlers.
 */

import { Type } from "@sinclair/typebox";
import { fetchCalendarEvents, type IcsCalendarConfig } from "./handlers.js";

type PluginApi = { registerTool: (t: unknown) => void; pluginConfig?: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }], details: {} };
}

function buildConfig(pluginConfig?: Record<string, unknown>): IcsCalendarConfig {
  const raw = pluginConfig?.calendars as Array<{ id: string; label: string; url: string }> | undefined;
  return { calendars: raw ?? [] };
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    calendars: { type: "array" as const, items: { type: "object" as const }, description: "List of calendar configs with id, label, url" },
  },
};

export function createEntry() {
  return {
    id: "ics-calendar",
    name: "ICS Calendar",
    description: "Fetch upcoming events from a published ICS calendar feed",
    configSchema,
    register(api: PluginApi) {
      const config = buildConfig(api.pluginConfig);

      api.registerTool({
        name: "ics_calendar_fetch",
        label: "ICS Calendar Fetch",
        description: "Fetch upcoming events from a published ICS calendar feed.",
        parameters: Type.Object({
          calendar_id: Type.Optional(Type.String({ description: "Configured calendar id from plugin config" })),
          url: Type.Optional(Type.String({ description: "Direct ICS URL override for one-off fetches" })),
          label: Type.Optional(Type.String({ description: "Optional display label when using a direct URL override" })),
          days: Type.Optional(Type.Integer({ description: "Number of days ahead to fetch (default 7)", default: 7 })),
        }),
        async execute(_id: string, p: Record<string, unknown>) {
          try {
            const result = await fetchCalendarEvents(
              {
                calendar_id: p.calendar_id as string | undefined,
                url: p.url as string | undefined,
                label: p.label as string | undefined,
                days: p.days as number | undefined,
              },
              config,
            );
            return fmt(result);
          } catch (e) {
            return fmt({ error: (e as Error).message });
          }
        },
      });
    },
  };
}
