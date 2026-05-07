/**
 * Shared mail-to-package-tracking helpers built on package_tracking_core.
 * TS port of mail_runtime_core/package_tracking.py
 */
import type { MailEnvelope } from "./runtime.js";
export interface TrackingClient {
    isShippingSender(senderEmail: string): boolean;
    scanTextForTrackingNumbers(text: string): Array<{
        tracking_number: string;
        carrier: string;
    }>;
    extractTrackingFromUrls(text: string): Array<{
        tracking_number: string;
        carrier: string;
    }>;
    fetchNarvarTracking(url: string): Array<{
        tracking_number: string;
        carrier: string;
    }>;
    addPackage(trackingNumber: string, carrier: string, label: string): Record<string, unknown>;
    removePackage(trackingNumber: string): Record<string, unknown>;
}
export declare const DELIVERY_KEYWORDS: string[];
export declare function isDeliveryNotification(subject: string | null | undefined): boolean;
export declare function loadTrackingClient(): TrackingClient;
export declare function scanAndAddPackages(envelope: MailEnvelope, options: {
    accountLabel: string;
    logger: (msg: string) => void;
    trackingClientLoader?: () => TrackingClient;
}): Promise<string[]>;
export declare function scanAndRemoveDelivered(envelope: MailEnvelope, options: {
    logger: (msg: string) => void;
    trackingClientLoader?: () => TrackingClient;
}): Promise<string[]>;
