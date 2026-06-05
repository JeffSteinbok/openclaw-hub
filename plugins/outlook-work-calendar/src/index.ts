/**
 * Outlook Work Calendar plugin — OpenClaw plugin shim.
 */

import { definePlugin } from "carapace-plugin-sdk";
import { Type } from "@sinclair/typebox";
import { fetchWorkCalendar, type OutlookWorkCalendarConfig } from "./handlers.js";

export const createEntry = definePlugin({
  id: "outlook-work-calendar",
  name: "Outlook Work Calendar",
  description: "Fetch upcoming events from the published Outlook work calendar. Uses the EWS JSON API — no authentication required.",

  configSchema: Type.Object({
    calendarUrl: Type.Optional(Type.String({ description: "Published Outlook work calendar base URL" })),
    folderId: Type.Optional(Type.String({ description: "EWS folder ID for the calendar" })),
  }),

  tools: (tool) => [
    tool({
      name: "outlook_work_calendar_fetch",
      label: "Outlook Work Calendar",
      description: "Fetch upcoming events from the published Outlook work calendar. Requires OUTLOOK_WORK_CALENDAR_URL and OUTLOOK_WORK_FOLDER_ID environment variables.",
      parameters: Type.Object({
        days: Type.Optional(Type.Integer({ description: "Number of days ahead to fetch (default 7)", default: 7 })),
      }),
      async execute({ days }, config) {
        try {
          const pluginConfig: OutlookWorkCalendarConfig = {
            calendarUrl: config.calendarUrl?.trim() || process.env.OUTLOOK_WORK_CALENDAR_URL || "",
            folderId: config.folderId?.trim() || process.env.OUTLOOK_WORK_FOLDER_ID || "",
          };
          return await fetchWorkCalendar(pluginConfig, { days });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),
  ],
});
