/**
 * Email body extraction and envelope conversion.
 */
// ── Body extraction ──────────────────────────────────────────
export function getEmailBodyText(email) {
    const bodyValues = email["bodyValues"];
    if (!bodyValues || Object.keys(bodyValues).length === 0)
        return "";
    const textBody = email["textBody"];
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
export function getEmailBodyHtml(email) {
    const bodyValues = email["bodyValues"];
    if (!bodyValues || Object.keys(bodyValues).length === 0)
        return "";
    const htmlBody = email["htmlBody"];
    if (htmlBody && htmlBody.length > 0) {
        const partId = htmlBody[0].partId ?? "";
        if (partId in bodyValues) {
            return bodyValues[partId].value ?? "";
        }
    }
    return "";
}
// ── Envelope conversion ──────────────────────────────────────
export function emailToEnvelope(email, accountId) {
    const from = email["from"];
    const sender = from && from.length > 0 ? from[0] : {};
    const senderName = sender.name ?? "";
    const senderEmail = sender.email ?? "unknown";
    const htmlBody = getEmailBodyHtml(email);
    const blobId = email["blobId"];
    const hasAttachments = !!(blobId && (htmlBody || "").includes("cid:"));
    const rawSubject = email["subject"] ?? "(no subject)";
    return {
        message_id: email["id"] ?? "",
        provider: "fastmail",
        account_id: accountId,
        mailbox_id: email["_matched_mailbox"] ?? null,
        sender_name: senderName,
        sender_email: senderEmail,
        subject: (rawSubject || "(no subject)").slice(0, 150),
        received_at: email["receivedAt"] ?? null,
        body_text: getEmailBodyText(email),
        body_html: htmlBody,
        has_attachments: hasAttachments,
        raw: email,
    };
}
