/**
 * Shared package tracking core — TS port of the Python package_tracking_core.
 *
 * Wire-compatible: reads and writes the same ~/.openclaw/package_tracking.json
 * as the Python version.
 */
export interface CarrierPattern {
    name: string;
    patterns: string[];
    url_template: string;
}
export declare const CARRIER_PATTERNS: CarrierPattern[];
export interface ValidationPattern {
    name: string;
    patterns: string[];
}
export declare const VALIDATION_PATTERNS: ValidationPattern[];
export declare function detectCarrier(trackingNumber: string): string | null;
export declare function getTrackingUrl(trackingNumber: string, carrier?: string | null): string | null;
export interface TrackingMatch {
    tracking_number: string;
    carrier: string;
    url: string;
}
export declare function scanTextForTrackingNumbers(text: string): TrackingMatch[];
export interface TrackedPackage {
    tracking_number: string;
    carrier: string;
    url: string;
    label: string;
    added_at: string;
    [key: string]: unknown;
}
export declare function addPackage(trackingNumber: string, carrier?: string | null, label?: string | null): Record<string, unknown>;
export declare function removePackage(trackingNumber: string): Record<string, unknown>;
export declare function listPackages(): {
    packages: TrackedPackage[];
    count: number;
};
export declare function getPackage(trackingNumber: string): Record<string, unknown>;
export declare const SHIPPING_SENDERS: string[];
export declare function isShippingSender(senderEmail: string): boolean;
export interface UrlExtractionRule {
    name: string;
    url_pattern: string;
    param_patterns: string[];
    carrier_from_path: boolean;
}
export declare const URL_EXTRACTION_RULES: UrlExtractionRule[];
export declare function extractTrackingFromUrls(text: string): TrackingMatch[];
export declare function fetchNarvarTracking(url: string): Promise<TrackingMatch[]>;
