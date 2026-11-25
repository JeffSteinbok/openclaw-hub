/**
 * Outlook Work Calendar plugin — OpenClaw plugin shim.
 */

import { ACCESS_CONFIG_SCHEMA, checkAccess, definePlugin, type AccessConfig } from "carapace-plugin-sdk";
import { Type } from "@sinclair/typebox";
import { fetchWorkCalendar, type OutlookWorkCalendarConfig, calendarView, WORK_CALENDAR_DAYS } from "./handlers.js";

/** ACL id of the single calendar this plugin serves. */
export const WORK_CALENDAR_ID = "work";

export const createEntry = definePlugin({
  id: "outlook-work-calendar",
  name: "Outlook Work Calendar",
  description: "Fetch upcoming events from the published Outlook work calendar. Uses the EWS JSON API — no authentication required.",

  configSchema: Type.Object({
    calendarUrl: Type.Optional(Type.String({ description: "Published Outlook work calendar base URL" })),
    folderId: Type.Optional(Type.String({ description: "EWS folder ID for the calendar" })),
    access: Type.Optional(Type.Unsafe<AccessConfig>({
      ...ACCESS_CONFIG_SCHEMA,
      description:
        'Read access keyed on agent and verified sender. This plugin exposes one calendar id, "work". ' +
        "Omit to allow every caller; once access.calendars is set, work must be listed to be readable.",
    })),
  }),

  tools: (tool) => [
    tool({
      name: "outlook_work_calendar_fetch",
      label: "Outlook Work Calendar",
      description: `Fetch events from the published work calendar. Future coverage is limited to ${WORK_CALENDAR_DAYS} days including today, Pacific time. Use days for a rolling window or after and before for an inclusive range.`,
      parameters: Type.Object({
        days: Type.Optional(Type.Integer({ description: "Number of days from today, including today (default 7). When only after is given, the default end is seven days after that date.", default: 7 })),
        after: Type.Optional(Type.String({ description: "First day to include (ISO date, e.g. 2026-03-01). Defaults to today." })),
        before: Type.Optional(Type.String({ description: "Last day to include, inclusive (ISO date). Pass the same value as `after` to query a single day." })),
        start_date: Type.Optional(Type.String({ description: "Alias for after (YYYY-MM-DD)." })),
        end_date: Type.Optional(Type.String({ description: "Alias for before (YYYY-MM-DD, inclusive)." })),
      }),
      async execute({ days, after, before, start_date, end_date }, config, ctx) {
        try {
          const decision = checkAccess(config.access, "calendars", WORK_CALENDAR_ID, "read", ctx);
          if (!decision.allowed) return { error: decision.message };
          const pluginConfig: OutlookWorkCalendarConfig = {
            calendarUrl: config.calendarUrl?.trim() || process.env.OUTLOOK_WORK_CALENDAR_URL || "",
            folderId: config.folderId?.trim() || process.env.OUTLOOK_WORK_FOLDER_ID || "",
          };
          return await fetchWorkCalendar(pluginConfig, { days, after: after ?? start_date, before: before ?? end_date });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
      view: calendarView,
    }),
  ],
});
