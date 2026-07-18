/**
 * Outlook plugin — unified mail + calendar tools via Microsoft Graph.
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
  getInbox,
  searchMail,
  readMessage,
  saveAttachments,
  sendMessage,
  replyToMessage,
  forwardMessage,
  moveMessage,
  flagMessage,
  type OutlookCalendarConfig,
} from "./handlers.js";

export const createEntry = definePlugin({
  id: "outlook",
  name: "Outlook",
  description: "Mail and calendar tools for Outlook via Microsoft Graph",

  configSchema: Type.Object({
    clientId: Type.Optional(Type.String({ description: "Microsoft OAuth client ID" })),
    clientSecret: Type.Optional(Type.String({ description: "Microsoft OAuth client secret" })),
    refreshToken: Type.Optional(Type.String({ description: "Microsoft OAuth refresh token" })),
    personalCalendarNames: Type.Optional(
      Type.Array(Type.String(), { description: "Additional personal calendar names to match." }),
    ),
    familyCalendarNames: Type.Optional(
      Type.Array(Type.String(), { description: "Additional family calendar names to match." }),
    ),
  }),

  tools: (tool) => [

    // -------------------------------------------------------------------------
    // Mail tools
    // -------------------------------------------------------------------------

    tool({
      name: "outlook_inbox",
      label: "Outlook Inbox",
      description: "List recent messages from the Outlook inbox, or any other mail folder.",
      parameters: Type.Object({
        folder: Type.Optional(Type.String({ description: "Mail folder to read (default: inbox). Well-known folder names: inbox, junkemail, deleteditems, sentitems, drafts, outbox, archive." })),
        limit: Type.Optional(Type.Integer({ description: "Maximum number of messages to return (default 10)." })),
        unread: Type.Optional(Type.Boolean({ description: "Only show unread messages." })),
      }),
      async execute({ folder, limit, unread }, config) {
        try {
          return await getInbox(resolveConfig(config), { folder, limit, unread });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "outlook_search",
      label: "Outlook Search",
      description: "Search Outlook messages by query text, sender, subject, or date range.",
      parameters: Type.Object({
        query: Type.Optional(Type.String({ description: "Full-text search across subject and body." })),
        from: Type.Optional(Type.String({ description: "Filter by sender email address." })),
        subject: Type.Optional(Type.String({ description: "Filter by subject (substring match)." })),
        since: Type.Optional(Type.String({ description: "Only messages received on or after this date (YYYY-MM-DD)." })),
        before: Type.Optional(Type.String({ description: "Only messages received on or before this date (YYYY-MM-DD)." })),
        limit: Type.Optional(Type.Integer({ description: "Maximum number of results (default 10)." })),
      }),
      async execute({ query, from, subject, since, before, limit }, config) {
        try {
          return await searchMail(resolveConfig(config), { query, from, subject, since, before, limit });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "outlook_read",
      label: "Outlook Read",
      description: "Read a specific Outlook message by its ID, including full body content.",
      parameters: Type.Object({
        message_id: Type.String({ description: "The Microsoft Graph message ID to retrieve." }),
      }),
      async execute({ message_id }, config) {
        try {
          return await readMessage(resolveConfig(config), { message_id });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "outlook_save_attachments",
      label: "Outlook Save Attachments",
      description: "Download attachments from an Outlook message to a local directory.",
      parameters: Type.Object({
        message_id: Type.String({ description: "The Microsoft Graph message ID." }),
        output_dir: Type.String({ description: "Local directory path to save attachments to (created if needed)." }),
        content_types: Type.Optional(Type.Array(Type.String(), { description: "Content type filters (e.g. ['image/*']). Defaults to ['image/*']." })),
      }),
      async execute({ message_id, output_dir, content_types }, config) {
        try {
          return await saveAttachments(resolveConfig(config), { message_id, output_dir, content_types });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "outlook_send",
      label: "Outlook Send",
      description: "Send a plain-text email via Outlook, with optional file attachments.",
      parameters: Type.Object({
        to: Type.Union([Type.String(), Type.Array(Type.String())], { description: "Recipient email address(es)." }),
        subject: Type.String({ description: "Email subject line." }),
        body: Type.String({ description: "Plain-text email body." }),
        cc: Type.Optional(Type.Array(Type.String(), { description: "CC recipient email address(es)." })),
        attachment: Type.Optional(Type.Array(Type.String(), { description: "File path(s) to attach." })),
        in_reply_to: Type.Optional(Type.String({ description: "Message-ID of the email being replied to (enables threading). Include angle brackets, e.g. <abc@mail.example.com>." })),
        references: Type.Optional(Type.String({ description: "Space-separated list of Message-IDs for the full thread References header." })),
        signature: Type.Optional(Type.String({ description: "Signature block appended after body." })),
      }),
      async execute(params, config) {
        try {
          return await sendMessage(resolveConfig(config), params);
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "outlook_reply",
      label: "Outlook Reply",
      description: "Reply to an existing Outlook message with proper threading. Handles In-Reply-To and References headers automatically via Microsoft Graph.",
      parameters: Type.Object({
        message_id: Type.String({ description: "The Microsoft Graph message ID to reply to." }),
        body: Type.String({ description: "Reply body text." }),
        reply_all: Type.Optional(Type.Boolean({ description: "Reply to all recipients (default: false)." })),
        signature: Type.Optional(Type.String({ description: "Signature block appended after body." })),
      }),
      async execute(params, config) {
        try {
          return await replyToMessage(resolveConfig(config), params);
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "outlook_forward",
      label: "Outlook Forward",
      description: "Forward an existing Outlook message to new recipients.",
      parameters: Type.Object({
        message_id: Type.String({ description: "The Microsoft Graph message ID to forward." }),
        to: Type.Union([Type.String(), Type.Array(Type.String())], { description: "Recipient email address(es) to forward to." }),
        comment: Type.Optional(Type.String({ description: "Optional note to prepend to the forwarded message." })),
      }),
      async execute(params, config) {
        try {
          return await forwardMessage(resolveConfig(config), params);
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "outlook_move",
      label: "Outlook Move",
      description: "Move an Outlook message to a different mail folder.",
      parameters: Type.Object({
        message_id: Type.String({ description: "The Microsoft Graph message ID to move." }),
        destination_folder: Type.String({ description: "Target folder name or well-known folder name (inbox, archive, deleteditems, junkemail, sentitems, drafts)." }),
      }),
      async execute(params, config) {
        try {
          return await moveMessage(resolveConfig(config), params);
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "outlook_flag",
      label: "Outlook Flag",
      description: "Flag, complete, or unflag an Outlook message.",
      parameters: Type.Object({
        message_id: Type.String({ description: "The Microsoft Graph message ID to flag." }),
        flag_status: Type.Union([Type.Literal("flagged"), Type.Literal("complete"), Type.Literal("notFlagged")], { description: "Flag status: 'flagged', 'complete', or 'notFlagged'." }),
      }),
      async execute(params, config) {
        try {
          return await flagMessage(resolveConfig(config), params);
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    // -------------------------------------------------------------------------
    // Calendar tools
    // -------------------------------------------------------------------------

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
          return await fetchCalendar(resolveConfig(config), { calendar, days });
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
          return await createEvent(resolveConfig(config), params);
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
          return await updateEvent(resolveConfig(config), params);
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
          return await deleteEvent(resolveConfig(config), params);
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
// Config resolver
// ---------------------------------------------------------------------------

function resolveConfig(config: {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  personalCalendarNames?: string[];
  familyCalendarNames?: string[];
}): OutlookCalendarConfig {
  const parseNames = (values: string[] | undefined, envKey: string): string[] => {
    if (Array.isArray(values)) return values.map(n => n.trim().toLowerCase()).filter(Boolean);
    return String(process.env[envKey] ?? "").split(",").map(n => n.trim().toLowerCase()).filter(Boolean);
  };
  return {
    clientId: config.clientId?.trim() || process.env.OUTLOOK_CLIENT_ID || "",
    clientSecret: config.clientSecret?.trim() || process.env.OUTLOOK_CLIENT_SECRET || "",
    refreshToken: config.refreshToken?.trim() || process.env.OUTLOOK_REFRESH_TOKEN || "",
    personalCalendarNames: parseNames(config.personalCalendarNames, "OUTLOOK_PERSONAL_CALENDAR_NAMES"),
    familyCalendarNames: parseNames(config.familyCalendarNames, "OUTLOOK_FAMILY_CALENDAR_NAMES"),
  };
}
