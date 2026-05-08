/**
 * Outlook Mail plugin — OpenClaw plugin shim.
 *
 * Constructs config from pluginConfig, registers tools that delegate to handlers.
 */

import { Type } from "@sinclair/typebox";
import { getInbox, searchMail, readMessage, saveAttachments, type OutlookMailConfig } from "./handlers.js";

type PluginApi = { registerTool: (t: unknown) => void; pluginConfig?: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(data: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(data) }], details: {} }; }

function buildConfig(pluginConfig?: Record<string, unknown>): OutlookMailConfig {
  const clientId = String(pluginConfig?.clientId ?? process.env.OUTLOOK_CLIENT_ID ?? "");
  const clientSecret = String(pluginConfig?.clientSecret ?? process.env.OUTLOOK_CLIENT_SECRET ?? "");
  const refreshToken = String(pluginConfig?.refreshToken ?? process.env.OUTLOOK_REFRESH_TOKEN ?? "");
  return { clientId, clientSecret, refreshToken };
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    clientId: { type: "string" as const, description: "Microsoft OAuth client ID" },
    clientSecret: { type: "string" as const, description: "Microsoft OAuth client secret" },
    refreshToken: { type: "string" as const, description: "Microsoft OAuth refresh token" },
  },
};

export function createEntry() {
  return {
    id: "outlook-mail",
    name: "Outlook Mail",
    description: "Search and read messages from Outlook inboxes",
    configSchema,
    register(api: PluginApi) {
      const config = buildConfig(api.pluginConfig);

      api.registerTool({
        name: "outlook_inbox",
        label: "Outlook Inbox",
        description: "List recent messages from the Outlook inbox, or any other mail folder.",
        parameters: Type.Object({
          limit: Type.Optional(Type.Integer({ description: "Maximum number of messages to return (default 10)." })),
          unread: Type.Optional(Type.Boolean({ description: "Only show unread messages." })),
          folder: Type.Optional(Type.String({ description: "Mail folder to read (default: inbox). Well-known folder names: inbox, junkemail, deleteditems, sentitems, drafts, outbox, archive." })),
        }),
        async execute(_id: string, p: Record<string, unknown>) {
          try {
            const result = await getInbox(config, {
              limit: p.limit as number | undefined,
              unread: p.unread as boolean | undefined,
              folder: p.folder as string | undefined,
            });
            return fmt(result);
          } catch (e) { return fmt({ error: (e as Error).message }); }
        },
      });

      api.registerTool({
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
        async execute(_id: string, p: Record<string, unknown>) {
          try {
            const result = await searchMail(config, {
              query: p.query as string | undefined,
              from: p.from as string | undefined,
              subject: p.subject as string | undefined,
              since: p.since as string | undefined,
              before: p.before as string | undefined,
              limit: p.limit as number | undefined,
            });
            return fmt(result);
          } catch (e) { return fmt({ error: (e as Error).message }); }
        },
      });

      api.registerTool({
        name: "outlook_read",
        label: "Outlook Read Message",
        description: "Read a specific Outlook message by its ID, including full body content.",
        parameters: Type.Object({
          message_id: Type.String({ description: "The Microsoft Graph message ID to retrieve." }),
        }),
        async execute(_id: string, p: Record<string, unknown>) {
          try {
            const result = await readMessage(config, {
              message_id: String(p.message_id ?? ""),
            });
            return fmt(result);
          } catch (e) { return fmt({ error: (e as Error).message }); }
        },
      });

      api.registerTool({
        name: "outlook_save_attachments",
        label: "Outlook Save Attachments",
        description: "Download attachments from an Outlook message to a local directory.",
        parameters: Type.Object({
          message_id: Type.String({ description: "The Microsoft Graph message ID." }),
          output_dir: Type.String({ description: "Local directory path to save attachments to (created if needed)." }),
          content_types: Type.Optional(Type.Array(Type.String(), { description: "Content type filters (e.g. ['image/*']). Defaults to ['image/*']." })),
        }),
        async execute(_id: string, p: Record<string, unknown>) {
          try {
            const result = await saveAttachments(config, {
              message_id: String(p.message_id ?? ""),
              output_dir: String(p.output_dir ?? ""),
              content_types: p.content_types as string[] | undefined,
            });
            return fmt(result);
          } catch (e) { return fmt({ error: (e as Error).message }); }
        },
      });
    },
  };
}
