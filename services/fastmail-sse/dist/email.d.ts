/**
 * Email body extraction and envelope conversion.
 */
import type { MailEnvelope } from "@openclaw/mail-runtime-core";
import type { JmapEmail } from "./jmap.js";
export declare function getEmailBodyText(email: Record<string, unknown>): string;
export declare function getEmailBodyHtml(email: Record<string, unknown>): string;
export declare function emailToEnvelope(email: JmapEmail | Record<string, unknown>, accountId: string): MailEnvelope;
