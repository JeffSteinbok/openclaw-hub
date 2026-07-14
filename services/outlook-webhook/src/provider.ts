/**
 * OutlookProviderClient — implements MailProviderClient for MS Graph.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AttachmentMeta,
  MailEnvelope,
  MailProviderClient,
} from "carapace-mail-runtime";
import https from "node:https";
import { fetchMessage, getAccessToken, type GraphConfig } from "./graph.js";

// ── Types ────────────────────────────────────────────────────

interface GraphAttachment {
  id: string;
  name?: string;
  contentType?: string;
  isInline?: boolean;
  contentId?: string;
  contentBytes?: string; // base64
  size?: number;
}

// ── Helpers ──────────────────────────────────────────────────

function contentTypeAllowed(
  contentType: string,
  allowedTypes: string[],
): boolean {
  for (const allowed of allowedTypes) {
    if (allowed.endsWith("/*")) {
      if (contentType.startsWith(allowed.slice(0, -1))) return true;
    } else if (contentType === allowed) {
      return true;
    }
  }
  return false;
}

async function fetchAttachments(
  config: GraphConfig,
  messageId: string,
): Promise<GraphAttachment[]> {
  const token = await getAccessToken(config);
  const url = `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}/attachments`;

  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        timeout: 30_000,
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Attachments fetch failed (${res.statusCode}): ${data.slice(0, 200)}`));
            return;
          }
          const json = JSON.parse(data) as { value?: GraphAttachment[] };
          resolve(json.value ?? []);
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

// ── Provider client ──────────────────────────────────────────

export class OutlookProviderClient implements MailProviderClient {
  private config: GraphConfig;
  private logger: (msg: string) => void;

  constructor(config: GraphConfig, logger: (msg: string) => void) {
    this.config = config;
    this.logger = logger;
  }

  async fetchBody(envelope: MailEnvelope): Promise<MailEnvelope> {
    // Body is already populated during envelope construction from Graph message.
    // Only fetch if body is missing.
    if (envelope.body_text != null || envelope.body_html != null) {
      return envelope;
    }

    this.logger(`fetchBody: re-fetching message ${envelope.message_id}`);
    const msg = await fetchMessage(this.config, envelope.message_id);

    const bodyHtml =
      msg.body?.contentType === "html" ? (msg.body.content ?? null) : null;
    const bodyText =
      msg.body?.contentType === "text" ? (msg.body.content ?? null) : (msg.bodyPreview ?? null);

    return {
      ...envelope,
      body_text: bodyText,
      body_html: bodyHtml,
      raw: { ...(envelope.raw ?? {}), ...(msg as unknown as Record<string, unknown>) },
    };
  }

  async listAttachments(envelope: MailEnvelope): Promise<AttachmentMeta[]> {
    if (!envelope.has_attachments) return [];

    const atts = await fetchAttachments(this.config, envelope.message_id);
    return atts.map((a) => ({
      name: a.name ?? "attachment",
      content_type: a.contentType ?? "application/octet-stream",
      is_inline: a.isInline ?? false,
      content_id: a.contentId ?? null,
    }));
  }

  async downloadAttachments(
    envelope: MailEnvelope,
    outputDir: string,
    options?: {
      content_types?: string[] | null;
      inline_only?: boolean | null;
      include_body_html?: boolean;
    },
  ): Promise<string[]> {
    mkdirSync(outputDir, { recursive: true });
    const saved: string[] = [];
    const contentTypes = options?.content_types ?? null;
    const inlineOnly = options?.inline_only ?? null;

    // Optionally save HTML body
    if (options?.include_body_html) {
      const html =
        envelope.body_html ??
        ((envelope.raw as Record<string, unknown> | undefined)?.["body"] as
          | { content?: string }
          | undefined)?.content;
      if (html) {
        writeFileSync(join(outputDir, "body.html"), html, "utf-8");
        saved.push("body.html");
      }
    }

    if (!envelope.has_attachments) return saved;

    const atts = await fetchAttachments(this.config, envelope.message_id);

    for (const att of atts) {
      if (!att.contentBytes) continue;

      const isInline = att.isInline ?? false;
      if (inlineOnly === true && !isInline) continue;
      if (inlineOnly === false && isInline) continue;

      const ct = att.contentType ?? "application/octet-stream";
      if (contentTypes && !contentTypeAllowed(ct, contentTypes)) continue;

      const filename = att.name ?? `attachment-${att.id}.bin`;
      writeFileSync(join(outputDir, filename), Buffer.from(att.contentBytes, "base64"));
      saved.push(filename);
    }

    return saved;
  }
}
