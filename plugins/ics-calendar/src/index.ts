/**
 * ICS Calendar plugin — OpenClaw plugin shim.
 */

import { ACCESS_CONFIG_SCHEMA, checkAccess, definePlugin, type AccessConfig } from "carapace-plugin-sdk";
import { Type } from "@sinclair/typebox";
import { fetchCalendarEvents, type IcsCalendarConfig, calendarView } from "./handlers.js";

/** ACL id for fetches by ad-hoc `url` rather than a configured `calendar_id`. */
export const URL_PSEUDO_CALENDAR = "_url";

export const createEntry = definePlugin({
  id: "ics-calendar",
  name: "ICS Calendar",
  description: "Fetch upcoming events from a published ICS calendar feed",

  configSchema: Type.Object({
    calendars: Type.Optional(
      Type.Array(
        Type.Object({
          id: Type.String({ description: "Calendar id" }),
          label: Type.String({ description: "Display label for the calendar" }),
          url: Type.String({ description: "Published ICS URL" }),
        }),
        { description: "List of calendar configs with id, label, url" },
      ),
    ),
    access: Type.Optional(Type.Unsafe<AccessConfig>({
      ...ACCESS_CONFIG_SCHEMA,
      description:
        "Per-calendar read access keyed on agent and verified sender. Keys of access.calendars are configured calendar ids; " +
        'the pseudo-id "_url" governs ad-hoc url fetches. Omit to allow every caller; once access.calendars is set, unlisted ids are denied.',
    })),
  }),

  tools: (tool) => [
    tool({
      name: "ics_calendar_fetch",
      label: "ICS Calendar Fetch",
      description: "Fetch upcoming events from a published ICS calendar feed.",
      parameters: Type.Object({
        calendar_id: Type.Optional(Type.String({ description: "Configured calendar id from plugin config" })),
        url: Type.Optional(Type.String({ description: "Direct ICS URL override for one-off fetches" })),
        label: Type.Optional(Type.String({ description: "Optional display label when using a direct URL override" })),
        days: Type.Optional(Type.Integer({ description: "Number of days ahead to fetch (default 7). Ignored when before is given.", default: 7 })),
        after: Type.Optional(Type.String({ description: "First day to include (ISO date, e.g. 2026-03-01). Defaults to today." })),
        before: Type.Optional(Type.String({ description: "Last day to include, inclusive (ISO date). Pass the same value as `after` to query a single day." })),
      }),
      async execute({ calendar_id, url, label, days, after, before }, config, ctx) {
        try {
          // An ad-hoc url is checked as the pseudo-calendar "_url" (it takes
          // precedence over calendar_id in the handler, so check it first).
          const resourceId = url ? URL_PSEUDO_CALENDAR : calendar_id;
          if (resourceId) {
            const decision = checkAccess(config.access, "calendars", resourceId, "read", ctx);
            if (!decision.allowed) return { error: decision.message };
          }
          const pluginConfig: IcsCalendarConfig = {
            calendars: config.calendars ?? [],
          };
          return await fetchCalendarEvents({ calendar_id, url, label, days, after, before }, pluginConfig);
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
      view: calendarView,
    }),
  ],
});
