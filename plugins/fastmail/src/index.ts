/**
 * FastMail plugin — pure TS-native implementation.
 *
 * Provides 7 tools for email operations (JMAP) and calendar management (CalDAV).
 */

import { definePlugin } from "carapace-plugin-sdk";
import { Type } from "@sinclair/typebox";
import { resolveConfig, cmdInbox, cmdSearch, cmdRead, cmdSend, cmdMeeting, cmdUpdateEvent, cmdQueryEvents } from "./handlers.js";

export const createEntry = definePlugin({
  id: "fastmail",
  name: "FastMail tools",
  description: "Send email and manage calendar events in Fastmail",

  configSchema: Type.Object({
    accountId: Type.Optional(Type.String({ description: "JMAP account identifier" })),
    jmapToken: Type.Optional(Type.String({ description: "JMAP API authentication token" })),
    fromEmail: Type.Optional(Type.String({ description: "Sender email address" })),
    fromName: Type.Optional(
      Type.String({
        description: "Sender display name",
        default: "OpenClaw Assistant",
      }),
    ),
    identityId: Type.Optional(Type.String({ description: "JMAP identity ID for sending" })),
    draftsId: Type.Optional(Type.String({ description: "JMAP mailbox ID for drafts" })),
    sentId: Type.Optional(Type.String({ description: "JMAP mailbox ID for sent mail" })),
    caldavUrl: Type.Optional(Type.String({ description: "CalDAV server URL" })),
    caldavUsername: Type.Optional(Type.String({ description: "CalDAV username" })),
    caldavPassword: Type.Optional(Type.String({ description: "CalDAV password" })),
    caldavCalendarPath: Type.Optional(Type.String({ description: "CalDAV calendar path" })),
  }),

  tools: (tool) => [
    tool({
      name: "fastmail_send",
      label: "Send Email",
      description:
        "Send a plain-text email via Fastmail JMAP, with optional file attachments.",
      parameters: Type.Object({
        to: Type.Union([Type.String(), Type.Array(Type.String())], {
          description: "Recipient email address(es)",
        }),
        subject: Type.String({ description: "Email subject line" }),
        body: Type.String({ description: "Plain-text email body" }),
        cc: Type.Optional(
          Type.Array(Type.String(), { description: "CC recipient email address(es)" }),
        ),
        signature: Type.Optional(
          Type.String({ description: "Signature block appended after body" }),
        ),
        attachment: Type.Optional(
          Type.Array(Type.String(), { description: "File path(s) to attach" }),
        ),
        in_reply_to: Type.Optional(
          Type.String({ description: "Message-ID of the email being replied to (enables threading). Include angle brackets, e.g. <abc@mail.example.com>." }),
        ),
        references: Type.Optional(
          Type.String({ description: "Space-separated list of Message-IDs for the full thread References header. Typically: prior References + In-Reply-To." }),
        ),
      }),
      async execute({ to, subject, body, cc, signature, attachment, in_reply_to, references }, config) {
        try {
          const resolvedConfig = resolveConfig({
            ...config,
            fromName: config.fromName?.trim() || "OpenClaw Assistant",
          });
          const output = await cmdSend(resolvedConfig, {
            to,
            cc,
            subject,
            body,
            signature,
            attachment,
            in_reply_to,
            references,
          });
          return { status: "ok", output };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),

    tool({
      name: "fastmail_search",
      label: "Search Emails",
      description:
        "Search emails in Fastmail inbox by keyword, sender, subject, or date range via JMAP.",
      parameters: Type.Object({
        query: Type.Optional(Type.String({ description: "Full-text search query" })),
        from: Type.Optional(Type.String({ description: "Filter by sender email or domain" })),
        to: Type.Optional(Type.String({ description: "Filter by recipient" })),
        subject: Type.Optional(Type.String({ description: "Filter by subject text" })),
        since: Type.Optional(Type.String({ description: "Emails after this date (YYYY-MM-DD)" })),
        before: Type.Optional(Type.String({ description: "Emails before this date (YYYY-MM-DD)" })),
        limit: Type.Optional(Type.Integer({ description: "Max results (default 20)" })),
        account_id: Type.Optional(Type.String({ description: "JMAP account ID override" })),
      }),
      async execute({ query, from, to, subject, since, before, limit, account_id }, config) {
        try {
          const resolvedConfig = resolveConfig({
            ...config,
            fromName: config.fromName?.trim() || "OpenClaw Assistant",
          });
          const accountId = account_id || resolvedConfig.accountId;
          const output = await cmdSearch(resolvedConfig.jmapToken, accountId, {
            query,
            sender: from,
            to,
            subject,
            since,
            before,
            limit,
          });
          return { status: "ok", output };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),

    tool({
      name: "fastmail_read",
      label: "Read Email",
      description:
        "Read a specific email by its JMAP email ID, returning full headers and body text.",
      parameters: Type.Object({
        id: Type.String({ description: "JMAP email ID to read" }),
        account_id: Type.Optional(Type.String({ description: "JMAP account ID override" })),
      }),
      async execute({ id, account_id }, config) {
        try {
          const resolvedConfig = resolveConfig({
            ...config,
            fromName: config.fromName?.trim() || "OpenClaw Assistant",
          });
          const accountId = account_id || resolvedConfig.accountId;
          const output = await cmdRead(resolvedConfig.jmapToken, accountId, id);
          return { status: "ok", output };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),

    tool({
      name: "fastmail_inbox",
      label: "Inbox",
      description:
        "Show recent emails from the Fastmail inbox, optionally filtered to unread only.",
      parameters: Type.Object({
        limit: Type.Optional(Type.Integer({ description: "Max emails to show (default 10)" })),
        unread: Type.Optional(Type.Boolean({ description: "Only show unread emails" })),
        account_id: Type.Optional(Type.String({ description: "JMAP account ID override" })),
      }),
      async execute({ limit, unread, account_id }, config) {
        try {
          const resolvedConfig = resolveConfig({
            ...config,
            fromName: config.fromName?.trim() || "OpenClaw Assistant",
          });
          const accountId = account_id || resolvedConfig.accountId;
          const output = await cmdInbox(resolvedConfig.jmapToken, accountId, {
            limit,
            unread,
          });
          return { status: "ok", output };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),

    tool({
      name: "fastmail_meeting",
      label: "Create Meeting",
      description:
        "Create a calendar meeting invite via CalDAV and send iMIP invitations to attendees.",
      parameters: Type.Object({
        to: Type.Union([Type.String(), Type.Array(Type.String())], {
          description: "Attendee email address(es)",
        }),
        subject: Type.String({ description: "Meeting title" }),
        start: Type.String({
          description: "Start datetime in ISO format (e.g. 2026-03-15T14:00)",
        }),
        cc: Type.Optional(
          Type.Array(Type.String(), { description: "CC recipient email address(es)" }),
        ),
        duration: Type.Optional(
          Type.String({ description: "Duration: '1h', '30m', '1.5h' (default: 1h)" }),
        ),
        location: Type.Optional(Type.String({ description: "Meeting location" })),
        description: Type.Optional(Type.String({ description: "Meeting description / agenda" })),
        timezone: Type.Optional(
          Type.String({ description: "IANA timezone (default: America/Los_Angeles)" }),
        ),
        signature: Type.Optional(
          Type.String({ description: "Signature block for the invite email" }),
        ),
      }),
      async execute({ to, cc, subject, start, duration, location, description, timezone, signature }, config) {
        try {
          const resolvedConfig = resolveConfig({
            ...config,
            fromName: config.fromName?.trim() || "OpenClaw Assistant",
          });
          const output = await cmdMeeting(resolvedConfig, {
            to,
            cc,
            subject,
            start,
            duration,
            location,
            description,
            timezone,
            signature,
          });
          return { status: "ok", output };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),

    tool({
      name: "fastmail_update_event",
      label: "Update Event",
      description:
        "Find a calendar event by UID or text search and update its title, time, location, attendees, or status.",
      parameters: Type.Object({
        uid: Type.Optional(Type.String({ description: "Exact event UID to target" })),
        find: Type.Optional(
          Type.String({ description: "Free-text search across event title/description" }),
        ),
        new_title: Type.Optional(Type.String({ description: "Replace the event title" })),
        new_start: Type.Optional(Type.String({ description: "New start time (ISO format)" })),
        new_duration: Type.Optional(
          Type.String({ description: "New duration (e.g. '1h', '30m')" }),
        ),
        new_location: Type.Optional(Type.String({ description: "Replace location" })),
        new_description: Type.Optional(
          Type.String({ description: "Replace description/notes" }),
        ),
        timezone: Type.Optional(
          Type.String({
            description: "Timezone for new_start (default: America/Los_Angeles)",
          }),
        ),
        status: Type.Optional(
          Type.Union(
            [Type.Literal("confirmed"), Type.Literal("tentative"), Type.Literal("cancelled")],
            { description: "Update event status" },
          ),
        ),
        add_attendee: Type.Optional(
          Type.Array(Type.String(), { description: "Email(s) to add as attendees" }),
        ),
        remove_attendee: Type.Optional(
          Type.Array(Type.String(), { description: "Email(s) to remove from attendees" }),
        ),
        force: Type.Optional(
          Type.Boolean({
            description: "Update all matching events when multiple found",
          }),
        ),
      }),
      async execute({ uid, find, new_title, new_start, new_duration, new_location, new_description, timezone, status, add_attendee, remove_attendee, force }, config) {
        try {
          const resolvedConfig = resolveConfig({
            ...config,
            fromName: config.fromName?.trim() || "OpenClaw Assistant",
          });
          const output = await cmdUpdateEvent(resolvedConfig, {
            uid,
            find,
            new_title,
            new_start,
            new_duration,
            new_location,
            new_description,
            timezone,
            status,
            add_attendee,
            remove_attendee,
            force,
          });
          return { status: "ok", output };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),

    tool({
      name: "fastmail_query_events",
      label: "Query Events",
      description:
        "Query calendar events by date range, text, attendee email, or UID. Shows attendee RSVP status.",
      parameters: Type.Object({
        after: Type.Optional(
          Type.String({
            description: "Only events starting at or after this date (ISO, e.g. 2026-03-01)",
          }),
        ),
        before: Type.Optional(
          Type.String({
            description: "Only events starting before this date (ISO, e.g. 2026-04-01)",
          }),
        ),
        text: Type.Optional(
          Type.String({ description: "Filter by text match on title/description" }),
        ),
        attendee: Type.Optional(
          Type.String({ description: "Filter to events including this attendee email" }),
        ),
        uid: Type.Optional(
          Type.String({ description: "Return the single event with this exact UID" }),
        ),
      }),
      async execute({ after, before, text, attendee, uid }, config) {
        try {
          const resolvedConfig = resolveConfig({
            ...config,
            fromName: config.fromName?.trim() || "OpenClaw Assistant",
          });
          const output = await cmdQueryEvents(resolvedConfig, {
            after,
            before,
            text,
            attendee,
            uid,
          });
          return { status: "ok", output };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),
  ],
});
