/**
 * Outlook Calendar plugin — OpenClaw plugin shim.
 */

import { definePlugin } from "carapace-plugin-sdk";
import { Type } from "@sinclair/typebox";
import { fetchCalendar, type OutlookCalendarConfig } from "./handlers.js";

export const createEntry = definePlugin({
  id: "outlook-calendar",
  name: "Outlook Calendar",
  description: "Fetch upcoming events from Outlook personal and family calendars",

  configSchema: Type.Object({
    clientId: Type.Optional(Type.String({ description: "Microsoft OAuth client ID" })),
    clientSecret: Type.Optional(Type.String({ description: "Microsoft OAuth client secret" })),
    refreshToken: Type.Optional(Type.String({ description: "Microsoft OAuth refresh token" })),
    personalCalendarNames: Type.Optional(
      Type.Array(Type.String(), {
        description: "Additional personal calendar names to match.",
      }),
    ),
    familyCalendarNames: Type.Optional(
      Type.Array(Type.String(), {
        description: "Additional family calendar names to match.",
      }),
    ),
  }),

  tools: (tool) => [
    tool({
      name: "outlook_calendar_fetch",
      label: "Outlook Calendar",
      description: "Fetch upcoming events from Outlook personal, family, or combined calendars.",
      parameters: Type.Object({
        calendar: Type.Optional(Type.Union([Type.Literal("personal"), Type.Literal("family"), Type.Literal("all")], { description: "Which calendar to fetch: personal, family, or all (default: all)." })),
        days: Type.Optional(Type.Integer({ description: "Number of days ahead to fetch events for (default: 7)." })),
      }),
      async execute({ calendar, days }, config) {
        try {
          const parseNames = (values: string[] | undefined, envKey: string): string[] => {
            if (Array.isArray(values)) {
              return values.map((name) => name.trim().toLowerCase()).filter(Boolean);
            }
            const raw = String(process.env[envKey] ?? "");
            return raw.split(",").map((name) => name.trim().toLowerCase()).filter(Boolean);
          };

          const pluginConfig: OutlookCalendarConfig = {
            clientId: config.clientId?.trim() || process.env.OUTLOOK_CLIENT_ID || "",
            clientSecret: config.clientSecret?.trim() || process.env.OUTLOOK_CLIENT_SECRET || "",
            refreshToken: config.refreshToken?.trim() || process.env.OUTLOOK_REFRESH_TOKEN || "",
            personalCalendarNames: parseNames(config.personalCalendarNames, "OUTLOOK_PERSONAL_CALENDAR_NAMES"),
            familyCalendarNames: parseNames(config.familyCalendarNames, "OUTLOOK_FAMILY_CALENDAR_NAMES"),
          };

          return await fetchCalendar(pluginConfig, { calendar, days });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),
  ],
});
