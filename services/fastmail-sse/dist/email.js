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
// ── Auth results parsing ──────────────────────────────────────
/**
 * Parse an Authentication-Results header value and extract DKIM, SPF, and DMARC outcomes.
 *
 * Header format (RFC 8601):
 *   Authentication-Results: mx.example.com;
 *     dkim=pass header.i=@example.com;
 *     spf=pass smtp.mailfrom=example.com;
 *     dmarc=pass
 */
export function parseAuthResults(raw) {
    if (!raw)
        return undefined;
    const text = raw.trim();
    function extractResult(proto) {
        // Match "proto=<result>" possibly preceded by whitespace, newline, or semicolon
        const match = text.match(new RegExp(`(?:^|[;\\n])\\s*${proto}=([a-zA-Z0-9-]+)`, "i"));
        return match ? match[1].toLowerCase() : undefined;
    }
    const dkim = extractResult("dkim");
    const spf = extractResult("spf");
    const dmarc = extractResult("dmarc");
    if (!dkim && !spf && !dmarc)
        return undefined;
    return { dkim, spf, dmarc, raw: text };
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
    // JMAP returns header pseudo-properties with the key matching the property name
    const authHeader = email["header:Authentication-Results:asText"];
    const authResults = parseAuthResults(authHeader);
    // Collect to/cc as formatted address strings for reply-all support
    const toAddresses = email["to"] ?? [];
    const ccAddresses = email["cc"] ?? [];
    const formatAddresses = (addrs) => addrs.map((a) => (a.name ? `${a.name} <${a.email ?? ""}>` : (a.email ?? ""))).join(", ");
    const toStr = formatAddresses(toAddresses);
    const ccStr = formatAddresses(ccAddresses);
    const headers = {};
    if (toStr)
        headers["to"] = toStr;
    if (ccStr)
        headers["cc"] = ccStr;
    if (authHeader)
        headers["authentication-results"] = authHeader;
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
        auth_results: authResults,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        raw: email,
    };
}
