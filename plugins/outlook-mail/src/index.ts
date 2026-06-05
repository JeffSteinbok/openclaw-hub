/**
 * Outlook Mail plugin — OpenClaw plugin shim.
 *
 * Constructs config from pluginConfig, registers tools that delegate to handlers.
 */

import { definePlugin } from "carapace-plugin-sdk";
import { Type } from "@sinclair/typebox";
import { getInbox, searchMail, readMessage, saveAttachments, type OutlookMailConfig } from "./handlers.js";

export const createEntry = definePlugin({
  id: "outlook-mail",
  name: "Outlook Mail",
  description: "Search and read messages from Outlook inboxes",

  configSchema: Type.Object({
    clientId: Type.Optional(Type.String({ description: "Microsoft OAuth client ID" })),
    clientSecret: Type.Optional(Type.String({ description: "Microsoft OAuth client secret" })),
    refreshToken: Type.Optional(Type.String({ description: "Microsoft OAuth refresh token" })),
  }),

  tools: (tool) => [
    tool({
      name: "outlook_inbox",
      label: "Outlook Inbox",
      description: "List recent messages from the Outlook inbox, or any other mail folder.",
      parameters: Type.Object({
        limit: Type.Optional(Type.Integer({ description: "Maximum number of messages to return (default 10)." })),
        unread: Type.Optional(Type.Boolean({ description: "Only show unread messages." })),
        folder: Type.Optional(Type.String({ description: "Mail folder to read (default: inbox). Well-known folder names: inbox, junkemail, deleteditems, sentitems, drafts, outbox, archive." })),
      }),
      async execute({ limit, unread, folder }, config) {
        try {
          const resolvedConfig: OutlookMailConfig = {
            clientId: String(config.clientId ?? process.env.OUTLOOK_CLIENT_ID ?? ""),
            clientSecret: String(config.clientSecret ?? process.env.OUTLOOK_CLIENT_SECRET ?? ""),
            refreshToken: String(config.refreshToken ?? process.env.OUTLOOK_REFRESH_TOKEN ?? ""),
          };
          return await getInbox(resolvedConfig, {
            limit,
            unread,
            folder,
          });
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
          const resolvedConfig: OutlookMailConfig = {
            clientId: String(config.clientId ?? process.env.OUTLOOK_CLIENT_ID ?? ""),
            clientSecret: String(config.clientSecret ?? process.env.OUTLOOK_CLIENT_SECRET ?? ""),
            refreshToken: String(config.refreshToken ?? process.env.OUTLOOK_REFRESH_TOKEN ?? ""),
          };
          return await searchMail(resolvedConfig, {
            query,
            from,
            subject,
            since,
            before,
            limit,
          });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "outlook_read",
      label: "Outlook Read Message",
      description: "Read a specific Outlook message by its ID, including full body content.",
      parameters: Type.Object({
        message_id: Type.String({ description: "The Microsoft Graph message ID to retrieve." }),
      }),
      async execute({ message_id }, config) {
        try {
          const resolvedConfig: OutlookMailConfig = {
            clientId: String(config.clientId ?? process.env.OUTLOOK_CLIENT_ID ?? ""),
            clientSecret: String(config.clientSecret ?? process.env.OUTLOOK_CLIENT_SECRET ?? ""),
            refreshToken: String(config.refreshToken ?? process.env.OUTLOOK_REFRESH_TOKEN ?? ""),
          };
          return await readMessage(resolvedConfig, {
            message_id: String(message_id ?? ""),
          });
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
          const resolvedConfig: OutlookMailConfig = {
            clientId: String(config.clientId ?? process.env.OUTLOOK_CLIENT_ID ?? ""),
            clientSecret: String(config.clientSecret ?? process.env.OUTLOOK_CLIENT_SECRET ?? ""),
            refreshToken: String(config.refreshToken ?? process.env.OUTLOOK_REFRESH_TOKEN ?? ""),
          };
          return await saveAttachments(resolvedConfig, {
            message_id: String(message_id ?? ""),
            output_dir: String(output_dir ?? ""),
            content_types,
          });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),
  ],
});
