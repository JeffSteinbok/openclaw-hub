/**
 * FastmailProviderClient — implements MailProviderClient for Fastmail JMAP.
 */
import type { AttachmentMeta, MailEnvelope, MailProviderClient } from "carapace-mail-runtime";
export declare class FastmailProviderClient implements MailProviderClient {
    private token;
    private logger;
    private downloadUrlTemplate;
    constructor(token: string, logger: (msg: string) => void);
    fetchBody(envelope: MailEnvelope): Promise<MailEnvelope>;
    listAttachments(envelope: MailEnvelope): Promise<AttachmentMeta[]>;
    downloadAttachments(envelope: MailEnvelope, outputDir: string, options?: {
        content_types?: string[] | null;
        inline_only?: boolean | null;
        include_body_html?: boolean;
    }): Promise<string[]>;
    private loadMimeMessage;
    private downloadMessageBlob;
    private getDownloadUrlTemplate;
    private extractHtmlBody;
}
