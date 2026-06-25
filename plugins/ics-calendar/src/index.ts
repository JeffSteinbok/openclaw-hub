/**
 * ICS Calendar plugin — OpenClaw plugin shim.
 */

import { definePlugin } from "carapace-plugin-sdk";
import { Type } from "@sinclair/typebox";
import { fetchCalendarEvents, type IcsCalendarConfig } from "./handlers.js";

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
        days: Type.Optional(Type.Integer({ description: "Number of days ahead to fetch (default 7)", default: 7 })),
      }),
      async execute({ calendar_id, url, label, days }, config) {
        try {
          const pluginConfig: IcsCalendarConfig = {
            calendars: config.calendars ?? [],
          };
          return await fetchCalendarEvents({ calendar_id, url, label, days }, pluginConfig);
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),
  ],
});
