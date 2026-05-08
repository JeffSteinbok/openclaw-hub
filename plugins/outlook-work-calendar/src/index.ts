/**
 * Outlook Work Calendar plugin — OpenClaw plugin shim.
 *
 * Constructs config from pluginConfig, registers tools that delegate to handlers.
 */

import { Type } from "@sinclair/typebox";
import { fetchWorkCalendar, type OutlookWorkCalendarConfig } from "./handlers.js";

type PluginApi = { registerTool: (t: unknown) => void; pluginConfig?: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(data: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(data) }], details: {} }; }

function buildConfig(pluginConfig?: Record<string, unknown>): OutlookWorkCalendarConfig {
  const calendarUrl = String(pluginConfig?.calendarUrl ?? process.env.OUTLOOK_WORK_CALENDAR_URL ?? "");
  const folderId = String(pluginConfig?.folderId ?? process.env.OUTLOOK_WORK_FOLDER_ID ?? "");
  return { calendarUrl, folderId };
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    calendarUrl: { type: "string" as const, description: "Published Outlook work calendar base URL" },
    folderId: { type: "string" as const, description: "EWS folder ID for the calendar" },
  },
};

export function createEntry() {
  return {
    id: "outlook-work-calendar",
    name: "Outlook Work Calendar",
    description: "Fetch upcoming events from the published Outlook work calendar. Uses the EWS JSON API — no authentication required.",
    configSchema,
    register(api: PluginApi) {
      const config = buildConfig(api.pluginConfig);

      api.registerTool({
        name: "outlook_work_calendar_fetch",
        label: "Outlook Work Calendar",
        description: "Fetch upcoming events from the published Outlook work calendar. Requires OUTLOOK_WORK_CALENDAR_URL and OUTLOOK_WORK_FOLDER_ID environment variables.",
        parameters: Type.Object({
          days: Type.Optional(Type.Integer({ description: "Number of days ahead to fetch (default 7)", default: 7 })),
        }),
        async execute(_id: string, p: Record<string, unknown>) {
          try {
            const result = await fetchWorkCalendar(config, {
              days: p.days as number | undefined,
            });
            return fmt(result);
          } catch (e) { return fmt({ error: (e as Error).message }); }
        },
      });
    },
  };
}
