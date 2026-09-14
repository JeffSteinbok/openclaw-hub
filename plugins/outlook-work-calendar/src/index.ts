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
      description: "Fetch events from the published Outlook work calendar, either a rolling window of days ahead or an explicit date range. Requires OUTLOOK_WORK_CALENDAR_URL and OUTLOOK_WORK_FOLDER_ID environment variables.",
      parameters: Type.Object({
        days: Type.Optional(Type.Integer({ description: "Number of days ahead to fetch (default 7). Ignored when after/before are given.", default: 7 })),
        after: Type.Optional(Type.String({ description: "First day to include (ISO date, e.g. 2026-03-01). Defaults to today." })),
        before: Type.Optional(Type.String({ description: "Last day to include, inclusive (ISO date). Pass the same value as `after` to query a single day." })),
      }),
      async execute({ days, after, before }, config) {
        try {
          const pluginConfig: OutlookWorkCalendarConfig = {
            calendarUrl: config.calendarUrl?.trim() || process.env.OUTLOOK_WORK_CALENDAR_URL || "",
            folderId: config.folderId?.trim() || process.env.OUTLOOK_WORK_FOLDER_ID || "",
          };
          return await fetchWorkCalendar(pluginConfig, { days, after, before });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),
  ],
});
