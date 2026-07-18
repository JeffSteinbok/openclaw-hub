/**
 * Outlook Calendar plugin — OpenClaw plugin shim.
 */

import { definePlugin } from "carapace-plugin-sdk";
import { Type } from "@sinclair/typebox";
import {
  fetchCalendar,
  createEvent,
  updateEvent,
  deleteEvent,
  createMeeting,
  queryEvents,
  type OutlookCalendarConfig,
} from "./handlers.js";

export const createEntry = definePlugin({
  id: "outlook-calendar",
  name: "Outlook Calendar",
  description: "Fetch and manage events on Outlook personal and family calendars",

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
          const pluginConfig = resolveConfig(config);
          return await fetchCalendar(pluginConfig, { calendar, days });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "outlook_create_event",
      label: "Outlook Create Event",
      description: "Create a new event on an Outlook personal or family calendar.",
      parameters: Type.Object({
        subject: Type.String({ description: "Event title." }),
        start: Type.String({ description: "Start datetime in ISO format (e.g. 2026-03-15T14:00)." }),
        duration: Type.Optional(Type.String({ description: "Duration: '1h', '30m', '1.5h' (default: 1h). Ignored when end is supplied." })),
        end: Type.Optional(Type.String({ description: "End datetime in ISO format. Overrides duration." })),
        timezone: Type.Optional(Type.String({ description: "IANA timezone (default: America/Los_Angeles)." })),
        location: Type.Optional(Type.String({ description: "Meeting location." })),
        description: Type.Optional(Type.String({ description: "Event description / agenda." })),
        attendees: Type.Optional(Type.Array(Type.String(), { description: "Attendee email addresses." })),
        calendar: Type.Optional(Type.Union([Type.Literal("personal"), Type.Literal("family")], { description: "Target calendar (default: personal)." })),
      }),
      async execute(params, config) {
        try {
          const pluginConfig = resolveConfig(config);
          return await createEvent(pluginConfig, params);
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "outlook_update_event",
      label: "Outlook Update Event",
      description: "Update an existing Outlook calendar event by event ID. Get the event ID from outlook_calendar_fetch.",
      parameters: Type.Object({
        event_id: Type.String({ description: "Graph event ID from outlook_calendar_fetch." }),
        subject: Type.Optional(Type.String({ description: "New event title." })),
        start: Type.Optional(Type.String({ description: "New start datetime in ISO format." })),
        end: Type.Optional(Type.String({ description: "New end datetime in ISO format." })),
        duration: Type.Optional(Type.String({ description: "New duration (e.g. '1h', '30m'). Requires start." })),
        timezone: Type.Optional(Type.String({ description: "IANA timezone for new start/end (default: America/Los_Angeles)." })),
        location: Type.Optional(Type.String({ description: "New location." })),
        description: Type.Optional(Type.String({ description: "New description." })),
        add_attendees: Type.Optional(Type.Array(Type.String(), { description: "Email addresses to add as attendees." })),
        remove_attendees: Type.Optional(Type.Array(Type.String(), { description: "Email addresses to remove from attendees." })),
        status: Type.Optional(Type.Union([Type.Literal("confirmed"), Type.Literal("tentative"), Type.Literal("cancelled")], { description: "Update event status." })),
      }),
      async execute(params, config) {
        try {
          const pluginConfig = resolveConfig(config);
          return await updateEvent(pluginConfig, params);
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "outlook_delete_event",
      label: "Outlook Delete Event",
      description: "Delete (cancel) an Outlook calendar event by event ID.",
      parameters: Type.Object({
        event_id: Type.String({ description: "Graph event ID to delete. Get this from outlook_calendar_fetch." }),
      }),
      async execute(params, config) {
        try {
          const pluginConfig = resolveConfig(config);
          return await deleteEvent(pluginConfig, params);
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),
    tool({
      name: "outlook_meeting",
      label: "Outlook Create Meeting",
      description: "Create a calendar meeting invite via Microsoft Graph and send invitations to attendees.",
      parameters: Type.Object({
        to: Type.Union([Type.String(), Type.Array(Type.String())], { description: "Attendee email address(es)." }),
        cc: Type.Optional(Type.Array(Type.String(), { description: "Optional attendees (will be marked as optional)." })),
        subject: Type.String({ description: "Meeting title." }),
        start: Type.String({ description: "Start datetime in ISO format (e.g. 2026-03-15T14:00)." }),
        duration: Type.Optional(Type.String({ description: "Duration: '1h', '30m', '1.5h' (default: 1h)." })),
        end: Type.Optional(Type.String({ description: "End datetime in ISO format. Overrides duration." })),
        timezone: Type.Optional(Type.String({ description: "IANA timezone (default: America/Los_Angeles)." })),
        location: Type.Optional(Type.String({ description: "Meeting location." })),
        description: Type.Optional(Type.String({ description: "Meeting description / agenda." })),
        signature: Type.Optional(Type.String({ description: "Signature block for the invite email." })),
      }),
      async execute(params, config) {
        try {
          return await createMeeting(resolveConfig(config), params);
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "outlook_query_events",
      label: "Outlook Query Events",
      description: "Query calendar events by date range, text, attendee email, or iCalUId.",
      parameters: Type.Object({
        after: Type.Optional(Type.String({ description: "Only events starting at or after this date (ISO, e.g. 2026-03-01)." })),
        before: Type.Optional(Type.String({ description: "Only events starting before this date (ISO, e.g. 2026-04-01)." })),
        text: Type.Optional(Type.String({ description: "Filter by text match on title." })),
        attendee: Type.Optional(Type.String({ description: "Filter to events including this attendee email." })),
        uid: Type.Optional(Type.String({ description: "Return the single event with this exact iCalUId." })),
      }),
      async execute(params, config) {
        try {
          return await queryEvents(resolveConfig(config), params);
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),
  ],
});

// ---------------------------------------------------------------------------
// Shared config resolver
// ---------------------------------------------------------------------------

function resolveConfig(config: {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  personalCalendarNames?: string[];
  familyCalendarNames?: string[];
}): OutlookCalendarConfig {
  const parseNames = (values: string[] | undefined, envKey: string): string[] => {
    if (Array.isArray(values)) {
      return values.map((name) => name.trim().toLowerCase()).filter(Boolean);
    }
    const raw = String(process.env[envKey] ?? "");
    return raw.split(",").map((name) => name.trim().toLowerCase()).filter(Boolean);
  };

  return {
    clientId: config.clientId?.trim() || process.env.OUTLOOK_CLIENT_ID || "",
    clientSecret: config.clientSecret?.trim() || process.env.OUTLOOK_CLIENT_SECRET || "",
    refreshToken: config.refreshToken?.trim() || process.env.OUTLOOK_REFRESH_TOKEN || "",
    personalCalendarNames: parseNames(config.personalCalendarNames, "OUTLOOK_PERSONAL_CALENDAR_NAMES"),
    familyCalendarNames: parseNames(config.familyCalendarNames, "OUTLOOK_FAMILY_CALENDAR_NAMES"),
  };
}
