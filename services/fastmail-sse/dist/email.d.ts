/**
 * Email body extraction and envelope conversion.
 */
import type { AuthResults, MailEnvelope } from "@openclaw/mail-runtime-core";
import type { JmapEmail } from "./jmap.js";
export declare function getEmailBodyText(email: Record<string, unknown>): string;
export declare function getEmailBodyHtml(email: Record<string, unknown>): string;
/**
 * Parse an Authentication-Results header value and extract DKIM, SPF, and DMARC outcomes.
 *
 * Header format (RFC 8601):
 *   Authentication-Results: mx.example.com;
 *     dkim=pass header.i=@example.com;
 *     spf=pass smtp.mailfrom=example.com;
 *     dmarc=pass
 */
export declare function parseAuthResults(raw: string | null | undefined): AuthResults | undefined;
export declare function emailToEnvelope(email: JmapEmail | Record<string, unknown>, accountId: string): MailEnvelope;
