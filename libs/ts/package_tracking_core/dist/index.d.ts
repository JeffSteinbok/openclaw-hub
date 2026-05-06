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
/**
 * The result returned by a carrier status provider for a given tracking number.
 */
export interface CarrierStatusResult {
    /** The normalised tracking number that was queried. */
    tracking_number: string;
    /** Carrier name (e.g. "UPS", "FedEx"). */
    carrier: string;
    /** Human-readable status string (e.g. "In Transit", "Delivered"). */
    status: string;
    /** True if the package has been delivered. */
    delivered: boolean;
    /** ISO-8601 timestamp of the last status update, or null if unavailable. */
    last_update: string | null;
    /** Optional free-text description / location from the carrier. */
    description: string | null;
    /** Any additional carrier-specific fields. */
    [key: string]: unknown;
}
/**
 * A pluggable carrier status provider.
 *
 * Implement this interface and register it with `statusRegistry` to add
 * live tracking support for one or more carriers.
 *
 * @example
 * const myProvider: CarrierStatusProvider = {
 *   name: 'MyCarrier',
 *   carriers: ['MyCarrier'],
 *   async getStatus(trackingNumber) {
 *     // fetch live status ...
 *     return { tracking_number: trackingNumber, carrier: 'MyCarrier', ... };
 *   },
 * };
 * statusRegistry.register(myProvider);
 */
export interface CarrierStatusProvider {
    /** Human-readable provider name (used in log messages). */
    name: string;
    /**
     * List of carrier names this provider handles (case-insensitive match).
     * Use `['*']` to handle all carriers.
     */
    carriers: string[];
    /**
     * Fetch live status for a tracking number.
     * Throw or return null to signal "not available".
     */
    getStatus(trackingNumber: string, carrier?: string): CarrierStatusResult | null | Promise<CarrierStatusResult | null>;
}
/**
 * Registry that holds all registered carrier status providers.
 *
 * Built-in providers can be added at startup; external providers are loaded
 * from `status_providers` paths in the plugin config.
 */
export declare class StatusProviderRegistry {
    private _providers;
    /**
     * Register a carrier status provider.
     * Later registrations take priority when multiple providers match a carrier.
     */
    register(provider: CarrierStatusProvider): void;
    /**
     * Find the first provider that handles the given carrier and return live status.
     * Returns `null` when no provider is registered for the carrier.
     */
    getStatus(trackingNumber: string, carrier?: string | null): Promise<CarrierStatusResult | null>;
    /** Returns true if at least one provider is registered. */
    get hasProviders(): boolean;
}
/**
 * Shared singleton status registry.
 * Plugins import and register against this instance.
 */
export declare const statusRegistry: StatusProviderRegistry;
/**
 * Interface for external carrier status plugin modules loaded dynamically at startup.
 * Any ESM module exporting a `register` function satisfies this interface.
 *
 * @example
 * // my-carrier-plugin/src/index.ts
 * import type { CarrierStatusPlugin, StatusProviderRegistry } from '@openclaw/package-tracking-core';
 * export const register: CarrierStatusPlugin['register'] = (registry) => {
 *   registry.register({
 *     name: 'MyCarrier',
 *     carriers: ['MyCarrier'],
 *     async getStatus(trackingNumber) {
 *       // fetch live status ...
 *       return { tracking_number: trackingNumber, carrier: 'MyCarrier', status: 'In Transit',
 *                delivered: false, last_update: null, description: null };
 *     },
 *   });
 * };
 */
export interface CarrierStatusPlugin {
    register(registry: StatusProviderRegistry): void | Promise<void>;
}
