/**
 * JMAP HTTP client functions.
 */
export type JmapMethodCall = [string, Record<string, unknown>, string];
export interface JmapResponse {
    methodResponses: Array<[string, Record<string, unknown>, string]>;
    [key: string]: unknown;
}
export interface JmapEmail {
    id: string;
    from?: Array<{
        name?: string;
        email?: string;
    }>;
    subject?: string;
    receivedAt?: string;
    textBody?: Array<{
        partId: string;
        type?: string;
    }>;
    htmlBody?: Array<{
        partId: string;
        type?: string;
    }>;
    bodyValues?: Record<string, {
        value: string;
        isEncodingProblem?: boolean;
        isTruncated?: boolean;
    }>;
    blobId?: string;
    mailboxIds?: Record<string, boolean>;
    _matched_mailbox?: string;
    _account_id?: string;
    [key: string]: unknown;
}
export declare function jmap(token: string, calls: JmapMethodCall[]): Promise<JmapResponse>;
export declare function getJmapSession(token: string): Promise<Record<string, unknown>>;
export declare function fetchNewEmails(token: string, accountId: string, oldState: string, inboxIds: string[]): Promise<JmapEmail[]>;
export declare function markAsRead(token: string, accountId: string, emailIds: string[]): Promise<void>;
export declare function getMailboxNames(token: string, accountId: string, inboxIds: string[]): Promise<Record<string, string>>;
