/**
 * Parse USPS Informed Delivery digest HTML to extract structured mailpiece data.
 */
export interface DigestResult {
    mail_count: number;
    package_count: number;
    from_labels: string[];
    image_cids: string[];
    tracking_numbers: string[];
    has_no_image: boolean;
}
export interface ParsedDigest extends DigestResult {
    date: string;
    images: string[];
    scan_images: string[];
    ad_images: string[];
}
/**
 * HTML parser that extracts mailpiece info from USPS digest HTML body.
 * Ports the Python MailpieceExtractor (html.parser.HTMLParser subclass).
 */
export declare class MailpieceExtractor {
    mailpieces: Record<string, unknown>[];
    packages: Record<string, unknown>[];
    private _currentFrom;
    private _mailCount;
    private _pkgCount;
    parse(html: string): void;
    private _handleData;
    get mailCount(): number | null;
    get pkgCount(): number | null;
}
/**
 * Parse a USPS digest HTML file and extract mail/package counts,
 * FROM labels, image CID references, and tracking numbers.
 */
export declare function parseDigestHtml(htmlPath: string): DigestResult;
/**
 * Parse all digest folders and return structured data keyed by date.
 */
export declare function parseAllDigests(baseDir: string): Record<string, ParsedDigest>;
