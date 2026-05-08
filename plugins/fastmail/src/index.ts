/**
 * FastMail plugin — pure TS-native implementation.
 *
 * Provides 7 tools for email operations (JMAP) and calendar management (CalDAV).
 */

import { Type } from "@sinclair/typebox";
import { resolveConfig, cmdInbox, cmdSearch, cmdRead, cmdSend, cmdMeeting, cmdUpdateEvent, cmdQueryEvents } from "./handlers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PluginApi = {
  registerTool: (tool: unknown) => void;
  pluginConfig?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    accountId: { type: "string" as const, description: "JMAP account identifier" },
    jmapToken: { type: "string" as const, description: "JMAP API authentication token" },
    fromEmail: { type: "string" as const, description: "Sender email address" },
    fromName: { type: "string" as const, description: "Sender display name" },
    identityId: { type: "string" as const, description: "JMAP identity ID for sending" },
    draftsId: { type: "string" as const, description: "JMAP mailbox ID for drafts" },
    sentId: { type: "string" as const, description: "JMAP mailbox ID for sent mail" },
    caldavUrl: { type: "string" as const, description: "CalDAV server URL" },
    caldavUsername: { type: "string" as const, description: "CalDAV username" },
    caldavPassword: { type: "string" as const, description: "CalDAV password" },
    caldavCalendarPath: { type: "string" as const, description: "CalDAV calendar path" },
  },
};

function formatResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data) }],
    details: {},
  };
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

function createEntry() {
  return {
    id: "fastmail",
    name: "FastMail tools",
    description: "Send email and manage calendar events in Fastmail",
    configSchema,
    register(api: PluginApi) {
      const getCfg = () => resolveConfig(api.pluginConfig);

      // 1. fastmail_send
      api.registerTool({
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
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          try {
            const output = await cmdSend(getCfg(), {
              to: params.to as string | string[],
              cc: params.cc as string[] | undefined,
              subject: params.subject as string,
              body: params.body as string,
              signature: params.signature as string | undefined,
              attachment: params.attachment as string[] | undefined,
            });
            return formatResult({ status: "ok", output });
          } catch (e) {
            return formatResult({ error: e instanceof Error ? e.message : String(e) });
          }
        },
      });

      // 2. fastmail_search
      api.registerTool({
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
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          try {
            const cfg = getCfg();
            const accountId = (params.account_id as string) || cfg.accountId;
            const output = await cmdSearch(cfg.jmapToken, accountId, {
              query: params.query as string | undefined,
              sender: (params.from as string) ?? (params.sender as string | undefined),
              to: params.to as string | undefined,
              subject: params.subject as string | undefined,
              since: params.since as string | undefined,
              before: params.before as string | undefined,
              limit: params.limit as number | undefined,
            });
            return formatResult({ status: "ok", output });
          } catch (e) {
            return formatResult({ error: e instanceof Error ? e.message : String(e) });
          }
        },
      });

      // 3. fastmail_read
      api.registerTool({
        name: "fastmail_read",
        label: "Read Email",
        description:
          "Read a specific email by its JMAP email ID, returning full headers and body text.",
        parameters: Type.Object({
          id: Type.String({ description: "JMAP email ID to read" }),
          account_id: Type.Optional(Type.String({ description: "JMAP account ID override" })),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          try {
            const cfg = getCfg();
            const accountId = (params.account_id as string) || cfg.accountId;
            const output = await cmdRead(cfg.jmapToken, accountId, params.id as string);
            return formatResult({ status: "ok", output });
          } catch (e) {
            return formatResult({ error: e instanceof Error ? e.message : String(e) });
          }
        },
      });

      // 4. fastmail_inbox
      api.registerTool({
        name: "fastmail_inbox",
        label: "Inbox",
        description:
          "Show recent emails from the Fastmail inbox, optionally filtered to unread only.",
        parameters: Type.Object({
          limit: Type.Optional(Type.Integer({ description: "Max emails to show (default 10)" })),
          unread: Type.Optional(Type.Boolean({ description: "Only show unread emails" })),
          account_id: Type.Optional(Type.String({ description: "JMAP account ID override" })),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          try {
            const cfg = getCfg();
            const accountId = (params.account_id as string) || cfg.accountId;
            const output = await cmdInbox(cfg.jmapToken, accountId, {
              limit: params.limit as number | undefined,
              unread: params.unread as boolean | undefined,
            });
            return formatResult({ status: "ok", output });
          } catch (e) {
            return formatResult({ error: e instanceof Error ? e.message : String(e) });
          }
        },
      });

      // 5. fastmail_meeting
      api.registerTool({
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
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          try {
            const output = await cmdMeeting(getCfg(), {
              to: params.to as string | string[],
              cc: params.cc as string[] | undefined,
              subject: params.subject as string,
              start: params.start as string,
              duration: params.duration as string | undefined,
              location: params.location as string | undefined,
              description: params.description as string | undefined,
              timezone: params.timezone as string | undefined,
              signature: params.signature as string | undefined,
            });
            return formatResult({ status: "ok", output });
          } catch (e) {
            return formatResult({ error: e instanceof Error ? e.message : String(e) });
          }
        },
      });

      // 6. fastmail_update_event
      api.registerTool({
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
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          try {
            const output = await cmdUpdateEvent(getCfg(), {
              uid: params.uid as string | undefined,
              find: params.find as string | undefined,
              new_title: params.new_title as string | undefined,
              new_start: params.new_start as string | undefined,
              new_duration: params.new_duration as string | undefined,
              new_location: params.new_location as string | undefined,
              new_description: params.new_description as string | undefined,
              timezone: params.timezone as string | undefined,
              status: params.status as string | undefined,
              add_attendee: params.add_attendee as string[] | undefined,
              remove_attendee: params.remove_attendee as string[] | undefined,
              force: params.force as boolean | undefined,
            });
            return formatResult({ status: "ok", output });
          } catch (e) {
            return formatResult({ error: e instanceof Error ? e.message : String(e) });
          }
        },
      });

      // 7. fastmail_query_events
      api.registerTool({
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
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          try {
            const output = await cmdQueryEvents(getCfg(), {
              after: params.after as string | undefined,
              before: params.before as string | undefined,
              text: params.text as string | undefined,
              attendee: params.attendee as string | undefined,
              uid: params.uid as string | undefined,
            });
            return formatResult({ status: "ok", output });
          } catch (e) {
            return formatResult({ error: e instanceof Error ? e.message : String(e) });
          }
        },
      });
    },
  };
}

export { createEntry };
