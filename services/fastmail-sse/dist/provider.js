/**
 * FastmailProviderClient — implements MailProviderClient for Fastmail JMAP.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { simpleParser } from "mailparser";
import { jmap, getJmapSession } from "./jmap.js";
import { getEmailBodyText, getEmailBodyHtml } from "./email.js";
// ── Helpers ──────────────────────────────────────────────────
function contentTypeAllowed(contentType, allowedTypes) {
    for (const allowed of allowedTypes) {
        if (allowed.endsWith("/*")) {
            if (contentType.startsWith(allowed.slice(0, -1)))
                return true;
        }
        else if (contentType === allowed) {
            return true;
        }
    }
    return false;
}
// ── Provider client ──────────────────────────────────────────
export class FastmailProviderClient {
    token;
    logger;
    downloadUrlTemplate = null;
    constructor(token, logger) {
        this.token = token;
        this.logger = logger;
    }
    async fetchBody(envelope) {
        if (envelope.body_text != null && envelope.body_html != null) {
            return envelope;
        }
        const result = await jmap(this.token, [
            [
                "Email/get",
                {
                    accountId: envelope.account_id,
                    ids: [envelope.message_id],
                    properties: [
                        "id",
                        "textBody",
                        "htmlBody",
                        "bodyValues",
                        "blobId",
                    ],
                    bodyProperties: ["partId", "type"],
                    fetchTextBodyValues: true,
                    fetchHTMLBodyValues: true,
                    maxBodyValueBytes: 50000,
                },
                "get",
            ],
        ]);
        const emails = result.methodResponses[0][1]["list"] ?? [];
        if (emails.length === 0) {
            throw new Error(`Fastmail message not found: ${envelope.message_id}`);
        }
        const raw = { ...(envelope.raw ?? {}), ...emails[0] };
        return {
            ...envelope,
            body_text: getEmailBodyText(raw),
            body_html: getEmailBodyHtml(raw),
            raw,
        };
    }
    async listAttachments(envelope) {
        const parsed = await this.loadMimeMessage(envelope);
        const attachments = [];
        for (const att of parsed.attachments ?? []) {
            const contentId = att.contentId?.replace(/^<|>$/g, "") || null;
            const filename = att.filename || (contentId ? `${contentId}.bin` : undefined);
            if (!filename)
                continue;
            attachments.push({
                name: filename,
                content_type: att.contentType,
                is_inline: att.contentDisposition === "inline" || !!contentId,
                content_id: contentId,
            });
        }
        return attachments;
    }
    async downloadAttachments(envelope, outputDir, options) {
        mkdirSync(outputDir, { recursive: true });
        const parsed = await this.loadMimeMessage(envelope);
        const saved = [];
        const contentTypes = options?.content_types ?? null;
        const inlineOnly = options?.inline_only ?? null;
        const includeBodyHtml = options?.include_body_html ?? false;
        // Extract and save HTML body if requested
        if (includeBodyHtml) {
            const htmlBody = this.extractHtmlBody(parsed);
            if (htmlBody) {
                writeFileSync(join(outputDir, "body.html"), htmlBody, "utf-8");
                saved.push("body.html");
            }
        }
        for (const att of parsed.attachments ?? []) {
            const contentId = att.contentId?.replace(/^<|>$/g, "") || null;
            const filename = att.filename || (contentId ? `${contentId}.bin` : undefined);
            if (!filename)
                continue;
            const isInline = att.contentDisposition === "inline" || !!contentId;
            if (inlineOnly === true && !isInline)
                continue;
            if (inlineOnly === false && isInline)
                continue;
            if (contentTypes &&
                !contentTypeAllowed(att.contentType, contentTypes))
                continue;
            if (!att.content || att.content.length === 0)
                continue;
            writeFileSync(join(outputDir, filename), att.content);
            saved.push(filename);
        }
        return saved;
    }
    // ── Private helpers ──────────────────────────────────────────
    async loadMimeMessage(envelope) {
        const rawBytes = await this.downloadMessageBlob(envelope);
        return simpleParser(rawBytes);
    }
    async downloadMessageBlob(envelope) {
        let blobId = envelope.raw?.["blobId"];
        if (!blobId) {
            const result = await jmap(this.token, [
                [
                    "Email/get",
                    {
                        accountId: envelope.account_id,
                        ids: [envelope.message_id],
                        properties: ["blobId"],
                    },
                    "blob",
                ],
            ]);
            const emails = result.methodResponses[0][1]["list"] ??
                [];
            if (emails.length === 0) {
                throw new Error(`Fastmail message not found: ${envelope.message_id}`);
            }
            blobId = emails[0]["blobId"];
        }
        if (!blobId) {
            throw new Error(`Fastmail message has no blobId: ${envelope.message_id}`);
        }
        const template = await this.getDownloadUrlTemplate();
        const url = template
            .replace("{accountId}", encodeURIComponent(envelope.account_id))
            .replace("{blobId}", encodeURIComponent(blobId))
            .replace("{name}", encodeURIComponent("message.eml"))
            .replace("{type}", encodeURIComponent("message/rfc822"));
        const resp = await fetch(url, {
            headers: { Authorization: `Bearer ${this.token}` },
        });
        if (!resp.ok) {
            throw new Error(`Blob download failed: ${resp.status}`);
        }
        const arrayBuf = await resp.arrayBuffer();
        return Buffer.from(arrayBuf);
    }
    async getDownloadUrlTemplate() {
        if (this.downloadUrlTemplate === null) {
            const session = await getJmapSession(this.token);
            const template = session["downloadUrl"];
            if (!template) {
                throw new Error("Fastmail JMAP session missing downloadUrl");
            }
            this.downloadUrlTemplate = template;
        }
        return this.downloadUrlTemplate;
    }
    extractHtmlBody(parsed) {
        return (typeof parsed.html === "string" ? parsed.html : "") || "";
    }
}
