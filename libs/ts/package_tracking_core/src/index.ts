/**
 * Shared package tracking core — TS port of the Python package_tracking_core.
 *
 * Wire-compatible: reads and writes the same ~/.openclaw/package_tracking.json
 * as the Python version.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";

// ---------------------------------------------------------------------------
// Carrier detection patterns (in order of specificity)
// ---------------------------------------------------------------------------

export interface CarrierPattern {
  name: string;
  patterns: string[];
  url_template: string;
}

export const CARRIER_PATTERNS: CarrierPattern[] = [
  {
    name: "UPS",
    patterns: ["\\b1Z[A-Z0-9]{16}\\b"],
    url_template: "https://www.ups.com/track?tracknum={tracking_number}",
  },
  {
    name: "Amazon",
    patterns: ["\\bTBA[0-9]{12}US\\b"],
    url_template: "https://track.amazon.com/tracking/{tracking_number}",
  },
  {
    name: "FedEx",
    patterns: ["\\b[0-9]{12}\\b", "\\b[0-9]{15}\\b", "\\b[0-9]{20}\\b"],
    url_template:
      "https://www.fedex.com/fedextrack/?trknbr={tracking_number}",
  },
  {
    name: "USPS",
    patterns: [
      "\\b94[0-9]{20}\\b",
      "\\b9[2-5][0-9]{20}\\b",
      "\\b[0-9]{20,22}\\b",
    ],
    url_template:
      "https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1={tracking_number}",
  },
];

export interface ValidationPattern {
  name: string;
  patterns: string[];
}

export const VALIDATION_PATTERNS: ValidationPattern[] = [
  { name: "UPS", patterns: ["^1Z[A-Z0-9]{16}$"] },
  { name: "Amazon", patterns: ["^TBA[0-9]{12}US$"] },
  {
    name: "FedEx",
    patterns: ["^[0-9]{12}$", "^[0-9]{15}$", "^[0-9]{20}$"],
  },
  {
    name: "USPS",
    patterns: [
      "^94[0-9]{20}$",
      "^9[2-5][0-9]{20}$",
      "^[0-9]{20,22}$",
    ],
  },
];

// ---------------------------------------------------------------------------
// Carrier detection
// ---------------------------------------------------------------------------

export function detectCarrier(trackingNumber: string): string | null {
  const upper = trackingNumber.trim().toUpperCase();
  for (const carrier of VALIDATION_PATTERNS) {
    for (const pattern of carrier.patterns) {
      if (new RegExp(pattern).test(upper)) {
        return carrier.name;
      }
    }
  }
  return null;
}

export function getTrackingUrl(
  trackingNumber: string,
  carrier?: string | null,
): string | null {
  const upper = trackingNumber.trim().toUpperCase();
  const resolvedCarrier = carrier ?? detectCarrier(upper);
  if (!resolvedCarrier) return null;

  const carrierUpper = resolvedCarrier.toUpperCase();
  for (const info of CARRIER_PATTERNS) {
    if (info.name.toUpperCase() === carrierUpper) {
      return info.url_template.replace("{tracking_number}", upper);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Text scanning
// ---------------------------------------------------------------------------

export interface TrackingMatch {
  tracking_number: string;
  carrier: string;
  url: string;
}

export function scanTextForTrackingNumbers(text: string): TrackingMatch[] {
  if (!text) return [];

  const upper = text.toUpperCase();
  const results: TrackingMatch[] = [];
  const seen = new Set<string>();

  for (const carrier of CARRIER_PATTERNS) {
    for (const pattern of carrier.patterns) {
      const re = new RegExp(pattern, "gm");
      let match: RegExpExecArray | null;
      while ((match = re.exec(upper)) !== null) {
        const num = match[0];
        if (seen.has(num)) continue;
        seen.add(num);
        results.push({
          tracking_number: num,
          carrier: carrier.name,
          url: carrier.url_template.replace("{tracking_number}", num),
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Package storage (wire-compatible with Python version)
// ---------------------------------------------------------------------------

export interface TrackedPackage {
  tracking_number: string;
  carrier: string;
  url: string;
  label: string;
  added_at: string;
  [key: string]: unknown;
}

function getStoragePath(): string {
  const openclawDir = join(homedir(), ".openclaw");
  mkdirSync(openclawDir, { recursive: true });
  return join(openclawDir, "package_tracking.json");
}

function loadPackages(): Record<string, TrackedPackage> {
  const path = getStoragePath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

function savePackages(packages: Record<string, TrackedPackage>): void {
  const path = getStoragePath();
  try {
    writeFileSync(path, JSON.stringify(packages, null, 2));
  } catch (e) {
    throw new Error(`Failed to save packages: ${e}`);
  }
}

function getTimestamp(): string {
  return new Date().toISOString().replace("+00:00", "Z");
}

export function addPackage(
  trackingNumber: string,
  carrier?: string | null,
  label?: string | null,
): Record<string, unknown> {
  const upper = trackingNumber.trim().toUpperCase();
  if (!upper) return { error: "tracking_number is required" };

  const resolvedCarrier = carrier ?? detectCarrier(upper);
  if (!resolvedCarrier) {
    return { error: `Could not detect carrier for tracking number: ${upper}` };
  }

  const url = getTrackingUrl(upper, resolvedCarrier);
  if (!url) {
    return { error: `Could not generate tracking URL for carrier: ${resolvedCarrier}` };
  }

  const packages = loadPackages();
  packages[upper] = {
    tracking_number: upper,
    carrier: resolvedCarrier,
    url,
    label: label ?? "",
    added_at: getTimestamp(),
  };
  savePackages(packages);
  return packages[upper];
}

export function removePackage(
  trackingNumber: string,
): Record<string, unknown> {
  const upper = trackingNumber.trim().toUpperCase();
  if (!upper) return { error: "tracking_number is required" };

  const packages = loadPackages();
  if (!(upper in packages)) {
    return { error: `Package not found: ${upper}` };
  }

  delete packages[upper];
  savePackages(packages);
  return { success: true, tracking_number: upper };
}

export function listPackages(): {
  packages: TrackedPackage[];
  count: number;
} {
  const packages = loadPackages();
  const values = Object.values(packages);
  return { packages: values, count: values.length };
}

export function getPackage(
  trackingNumber: string,
): Record<string, unknown> {
  const upper = trackingNumber.trim().toUpperCase();
  if (!upper) return { error: "tracking_number is required" };

  const packages = loadPackages();
  if (!(upper in packages)) {
    return { error: `Package not found: ${upper}` };
  }

  return packages[upper];
}

// ---------------------------------------------------------------------------
// Shipping sender detection
// ---------------------------------------------------------------------------

export const SHIPPING_SENDERS: string[] = [
  "ups.com",
  "fedex.com",
  "usps.com",
  "dhl.com",
  "ontrac.com",
  "lasership.com",
  "amazon.com",
  "amazonlogistics.com",
  "narvar.com",
  "aftership.com",
  "shipbob.com",
  "shipstation.com",
  "easypost.com",
  "noreply@nespresso.com",
];

export function isShippingSender(senderEmail: string): boolean {
  if (!senderEmail) return false;

  const lower = senderEmail.toLowerCase().trim();
  for (const entry of SHIPPING_SENDERS) {
    const entryLower = entry.toLowerCase();
    if (entryLower.includes("@")) {
      if (lower === entryLower) return true;
      continue;
    }
    if (
      lower.endsWith("@" + entryLower) ||
      new RegExp(`@(?:[a-z0-9-]+\\.)*${escapeRegExp(entryLower)}$`).test(lower)
    ) {
      return true;
    }
  }
  return false;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// URL extraction rules
// ---------------------------------------------------------------------------

export interface UrlExtractionRule {
  name: string;
  url_pattern: string;
  param_patterns: string[];
  carrier_from_path: boolean;
}

export const URL_EXTRACTION_RULES: UrlExtractionRule[] = [
  {
    name: "Narvar",
    url_pattern: "https?://[^\\s\"'<>]*narvar\\.com/[^\\s\"'<>]*",
    param_patterns: [
      "[?&]tracking_numbers?=([A-Z0-9]{10,30})",
      "[?&]tracking=([A-Z0-9]{10,30})",
    ],
    carrier_from_path: true,
  },
  {
    name: "UPS",
    url_pattern: "https?://[^\\s\"'<>]*ups\\.com/track[^\\s\"'<>]*",
    param_patterns: [
      "[?&]tracknum=(1Z[A-Z0-9]{16})",
      "[?&]InquiryNumber1=(1Z[A-Z0-9]{16})",
    ],
    carrier_from_path: false,
  },
  {
    name: "FedEx",
    url_pattern:
      "https?://[^\\s\"'<>]*fedex\\.com/[^\\s\"'<>]*track[^\\s\"'<>]*",
    param_patterns: [
      "[?&]trknbr=(\\d{12,22})",
      "[?&]trackingnumber=(\\d{12,22})",
      "[?&]trackingNumber=(\\d{12,22})",
    ],
    carrier_from_path: false,
  },
  {
    name: "USPS",
    url_pattern: "https?://[^\\s\"'<>]*usps\\.com/[^\\s\"'<>]*",
    param_patterns: [
      "[?&]qtc_tLabels\\d?=(\\d{20,22})",
      "[?&]tLabels=(\\d{20,22})",
    ],
    carrier_from_path: false,
  },
  {
    name: "Amazon",
    url_pattern:
      "https?://[^\\s\"'<>]*amazon\\.com/[^\\s\"'<>]*(?:track|order)[^\\s\"'<>]*",
    param_patterns: ["[?&]tracking-id=(TBA[0-9]{12}US)"],
    carrier_from_path: false,
  },
];

const NARVAR_CARRIER_PATH_MAP: Record<string, string> = {
  ups: "UPS",
  fedex: "FedEx",
  usps: "USPS",
  dhl: "DHL",
  ontrac: "OnTrac",
  amazon: "Amazon",
};

const NARVAR_PAGE_PATTERNS: string[] = [
  '"trackingNumber"\\s*:\\s*"([A-Z0-9]{10,30})"',
  '["\']tracking_number["\']\\s*:\\s*["\']([A-Z0-9]{10,30})["\']',
  '["\']tracking["\']\\s*:\\s*["\']([A-Z0-9]{10,30})["\']',
  'data-tracking[-_]?number=["\']([A-Z0-9]{10,30})["\']',
  '<[^>]*class="[^"]*tracking[^"]*"[^>]*>\\s*([A-Z0-9]{10,30})\\s*<',
];

function carrierFromNarvarUrl(url: string): string | null {
  const lower = url.toLowerCase();
  for (const [seg, carrier] of Object.entries(NARVAR_CARRIER_PATH_MAP)) {
    if (
      lower.includes(`/tracking/${seg}`) ||
      lower.includes(`/tracking/${seg}?`)
    ) {
      return carrier;
    }
  }
  return null;
}

export function extractTrackingFromUrls(text: string): TrackingMatch[] {
  if (!text) return [];

  const results: TrackingMatch[] = [];
  const seen = new Set<string>();

  for (const rule of URL_EXTRACTION_RULES) {
    const urlRe = new RegExp(rule.url_pattern, "gi");
    let urlMatch: RegExpExecArray | null;
    while ((urlMatch = urlRe.exec(text)) !== null) {
      const url = urlMatch[0];
      const carrierHint = rule.carrier_from_path
        ? carrierFromNarvarUrl(url) ?? rule.name
        : rule.name;

      for (const paramPattern of rule.param_patterns) {
        const paramMatch = new RegExp(paramPattern, "i").exec(url);
        if (!paramMatch) continue;
        const trackingNum = paramMatch[1].toUpperCase();
        if (seen.has(trackingNum)) break;
        seen.add(trackingNum);
        const carrier = carrierHint || detectCarrier(trackingNum) || "Unknown";
        const trackingUrl = getTrackingUrl(trackingNum, carrier) ?? url;
        results.push({
          tracking_number: trackingNum,
          carrier,
          url: trackingUrl,
        });
        break;
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Narvar page fetching
// ---------------------------------------------------------------------------

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? httpsRequest : httpRequest;
    const req = mod(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; OpenClaw/1.0; +https://github.com/JeffSteinbok/openclaw)",
        },
        timeout: 15_000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk));
        res.on("end", () => resolve(data));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    req.end();
  });
}

export async function fetchNarvarTracking(
  url: string,
): Promise<TrackingMatch[]> {
  const found = extractTrackingFromUrls(url);
  if (found.length > 0) return found;

  let html: string;
  try {
    html = await httpGet(url);
  } catch {
    return [];
  }

  const results: TrackingMatch[] = [];
  const seen = new Set<string>();

  for (const pattern of NARVAR_PAGE_PATTERNS) {
    const re = new RegExp(pattern, "gi");
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) !== null) {
      const trackingNum = match[1].toUpperCase();
      if (seen.has(trackingNum)) continue;
      const carrier = detectCarrier(trackingNum);
      if (!carrier) continue;
      seen.add(trackingNum);
      const trackingUrl = getTrackingUrl(trackingNum, carrier) ?? url;
      results.push({
        tracking_number: trackingNum,
        carrier,
        url: trackingUrl,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Carrier status providers
// ---------------------------------------------------------------------------

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
  getStatus(
    trackingNumber: string,
    carrier?: string,
  ): CarrierStatusResult | null | Promise<CarrierStatusResult | null>;
}

/**
 * Registry that holds all registered carrier status providers.
 *
 * Built-in providers can be added at startup; external providers are loaded
 * from `status_providers` paths in the plugin config.
 */
export class StatusProviderRegistry {
  private _providers: CarrierStatusProvider[] = [];

  /**
   * Register a carrier status provider.
   * Later registrations take priority when multiple providers match a carrier.
   */
  register(provider: CarrierStatusProvider): void {
    this._providers.unshift(provider); // latest wins
  }

  /**
   * Find the first provider that handles the given carrier and return live status.
   * Returns `null` when no provider is registered for the carrier.
   */
  async getStatus(
    trackingNumber: string,
    carrier?: string | null,
  ): Promise<CarrierStatusResult | null> {
    const resolvedCarrier = carrier ?? detectCarrier(trackingNumber) ?? "Unknown";
    const carrierLower = resolvedCarrier.toLowerCase();

    for (const provider of this._providers) {
      const handles =
        provider.carriers.includes("*") ||
        provider.carriers.some((c) => c.toLowerCase() === carrierLower);
      if (!handles) continue;
      try {
        const result = await provider.getStatus(trackingNumber, resolvedCarrier);
        if (result !== null) return result;
      } catch {
        // provider failed — try next
      }
    }
    return null;
  }

  /** Returns true if at least one provider is registered. */
  get hasProviders(): boolean {
    return this._providers.length > 0;
  }
}

/**
 * Shared singleton status registry.
 * Plugins import and register against this instance.
 */
export const statusRegistry = new StatusProviderRegistry();

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
