/**
 * Outlook Calendar plugin — OpenClaw plugin shim.
 *
 * Constructs config from pluginConfig, registers tools that delegate to handlers.
 */

import { Type } from "@sinclair/typebox";
import { fetchCalendar, type OutlookCalendarConfig } from "./handlers.js";

type PluginApi = { registerTool: (t: unknown) => void; pluginConfig?: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(data: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(data) }], details: {} }; }

function buildConfig(pluginConfig?: Record<string, unknown>): OutlookCalendarConfig {
  const clientId = String(pluginConfig?.clientId ?? process.env.OUTLOOK_CLIENT_ID ?? "");
  const clientSecret = String(pluginConfig?.clientSecret ?? process.env.OUTLOOK_CLIENT_SECRET ?? "");
  const refreshToken = String(pluginConfig?.refreshToken ?? process.env.OUTLOOK_REFRESH_TOKEN ?? "");
  const parseNames = (v: unknown, envKey: string): string[] => {
    if (Array.isArray(v)) return v.map(String);
    const raw = String(v ?? process.env[envKey] ?? "");
    return raw.split(",").map(n => n.trim().toLowerCase()).filter(Boolean);
  };
  const personalCalendarNames = parseNames(pluginConfig?.personalCalendarNames, "OUTLOOK_PERSONAL_CALENDAR_NAMES");
  const familyCalendarNames = parseNames(pluginConfig?.familyCalendarNames, "OUTLOOK_FAMILY_CALENDAR_NAMES");
  return { clientId, clientSecret, refreshToken, personalCalendarNames, familyCalendarNames };
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    clientId: { type: "string" as const, description: "Microsoft OAuth client ID" },
    clientSecret: { type: "string" as const, description: "Microsoft OAuth client secret" },
    refreshToken: { type: "string" as const, description: "Microsoft OAuth refresh token" },
  },
};

export function createEntry() {
  return {
    id: "outlook-calendar",
    name: "Outlook Calendar",
    description: "Fetch upcoming events from Outlook personal and family calendars",
    configSchema,
    register(api: PluginApi) {
      const config = buildConfig(api.pluginConfig);

      api.registerTool({
        name: "outlook_calendar_fetch",
        label: "Outlook Calendar",
        description: "Fetch upcoming events from Outlook personal, family, or combined calendars.",
        parameters: Type.Object({
          calendar: Type.Optional(Type.Union([Type.Literal("personal"), Type.Literal("family"), Type.Literal("all")], { description: "Which calendar to fetch: personal, family, or all (default: all)." })),
          days: Type.Optional(Type.Integer({ description: "Number of days ahead to fetch events for (default: 7)." })),
        }),
        async execute(_id: string, p: Record<string, unknown>) {
          try {
            const result = await fetchCalendar(config, {
              calendar: p.calendar as string | undefined,
              days: p.days as number | undefined,
            });
            return fmt(result);
          } catch (e) { return fmt({ error: (e as Error).message }); }
        },
      });
    },
  };
}
