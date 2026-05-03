/**
 * Email body extraction and envelope conversion.
 */

import type { MailEnvelope } from "@openclaw/mail-runtime-core";
import type { JmapEmail } from "./jmap.js";

// ── Body extraction ──────────────────────────────────────────

export function getEmailBodyText(
  email: Record<string, unknown>,
): string {
  const bodyValues = email["bodyValues"] as
    | Record<string, { value: string }>
    | undefined;
  if (!bodyValues || Object.keys(bodyValues).length === 0) return "";

  const textBody = email["textBody"] as
    | Array<{ partId: string }>
    | undefined;
  if (textBody && textBody.length > 0) {
    const partId = textBody[0].partId ?? "";
    if (partId in bodyValues) {
      return bodyValues[partId].value ?? "";
    }
  }

  // Fallback: use any available body value
  for (const part of Object.values(bodyValues)) {
    return part.value ?? "";
  }

  return "";
}

export function getEmailBodyHtml(
  email: Record<string, unknown>,
): string {
  const bodyValues = email["bodyValues"] as
    | Record<string, { value: string }>
    | undefined;
  if (!bodyValues || Object.keys(bodyValues).length === 0) return "";

  const htmlBody = email["htmlBody"] as
    | Array<{ partId: string }>
    | undefined;
  if (htmlBody && htmlBody.length > 0) {
    const partId = htmlBody[0].partId ?? "";
    if (partId in bodyValues) {
      return bodyValues[partId].value ?? "";
    }
  }

  return "";
}

// ── Envelope conversion ──────────────────────────────────────

export function emailToEnvelope(
  email: JmapEmail | Record<string, unknown>,
  accountId: string,
): MailEnvelope {
  const from = email["from"] as
    | Array<{ name?: string; email?: string }>
    | undefined;
  const sender = from && from.length > 0 ? from[0] : {};
  const senderName = sender.name ?? "";
  const senderEmail = sender.email ?? "unknown";
  const htmlBody = getEmailBodyHtml(email);
  const blobId = email["blobId"];
  const hasAttachments = !!(blobId && (htmlBody || "").includes("cid:"));
  const rawSubject = (email["subject"] as string) ?? "(no subject)";

  return {
    message_id: (email["id"] as string) ?? "",
    provider: "fastmail",
    account_id: accountId,
    mailbox_id: (email["_matched_mailbox"] as string) ?? null,
    sender_name: senderName,
    sender_email: senderEmail,
    subject: (rawSubject || "(no subject)").slice(0, 150),
    received_at: (email["receivedAt"] as string) ?? null,
    body_text: getEmailBodyText(email),
    body_html: htmlBody,
    has_attachments: hasAttachments,
    raw: email as Record<string, unknown>,
  };
}
