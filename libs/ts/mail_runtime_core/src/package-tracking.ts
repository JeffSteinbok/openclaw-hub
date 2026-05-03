/**
 * Shared mail-to-package-tracking helpers built on package_tracking_core.
 * TS port of mail_runtime_core/package_tracking.py
 */

import * as packageTrackingCore from "@openclaw/package-tracking-core";
import type { MailEnvelope } from "./runtime.js";

// ---------------------------------------------------------------------------
// TrackingClient interface
// ---------------------------------------------------------------------------

export interface TrackingClient {
  isShippingSender(senderEmail: string): boolean;
  scanTextForTrackingNumbers(text: string): Array<{ tracking_number: string; carrier: string }>;
  extractTrackingFromUrls(text: string): Array<{ tracking_number: string; carrier: string }>;
  fetchNarvarTracking(url: string): Array<{ tracking_number: string; carrier: string }>;
  addPackage(trackingNumber: string, carrier: string, label: string): Record<string, unknown>;
  removePackage(trackingNumber: string): Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DELIVERY_KEYWORDS = [
  "delivered",
  "package delivered",
  "your order has been delivered",
  "delivery complete",
  "successfully delivered",
  "has been delivered",
  "your package was delivered",
  "item delivered",
  "order delivered",
];

const AMAZON_DOMAINS = ["amazon.com", "amazonlogistics.com"];
const NARVAR_URL_PATTERN = /https?:\/\/[^\s"'<>]*narvar\.com\/[^\s"'<>]*/gi;

// ---------------------------------------------------------------------------
// isDeliveryNotification
// ---------------------------------------------------------------------------

export function isDeliveryNotification(subject: string | null | undefined): boolean {
  const low = (subject ?? "").toLowerCase();
  return DELIVERY_KEYWORDS.some((kw) => low.includes(kw));
}

// ---------------------------------------------------------------------------
// loadTrackingClient
// ---------------------------------------------------------------------------

export function loadTrackingClient(): TrackingClient {
  return packageTrackingCore as unknown as TrackingClient;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function combinedBody(envelope: MailEnvelope): string {
  return [envelope.body_text, envelope.body_html].filter(Boolean).join(" ");
}

function isAmazonSender(senderEmail: string): boolean {
  const low = (senderEmail ?? "").toLowerCase();
  return AMAZON_DOMAINS.some(
    (domain) =>
      low.endsWith("@" + domain) ||
      new RegExp(`@(?:[a-z0-9-]+\\.)*${domain.replace(/\./g, "\\.")}$`).test(low),
  );
}

// ---------------------------------------------------------------------------
// scanAndAddPackages
// ---------------------------------------------------------------------------

export async function scanAndAddPackages(
  envelope: MailEnvelope,
  options: {
    accountLabel: string;
    logger: (msg: string) => void;
    trackingClientLoader?: () => TrackingClient;
  },
): Promise<string[]> {
  const { accountLabel, logger, trackingClientLoader = loadTrackingClient } = options;
  const senderEmail = envelope.sender_email || "unknown";
  const senderName = envelope.sender_name || "";
  const subject = envelope.subject || "(no subject)";

  try {
    const trackingClient = trackingClientLoader();

    if (!trackingClient.isShippingSender(senderEmail)) {
      logger(`skipping tracking scan: non-shipping sender ${senderEmail}`);
      return [];
    }

    if (isAmazonSender(senderEmail)) {
      logger(
        `skipping tracking scan: Amazon sender ${senderEmail} (not trackable externally)`,
      );
      return [];
    }

    const bodyText = envelope.body_text || "";
    const found = bodyText
      ? trackingClient.scanTextForTrackingNumbers(bodyText)
      : [];

    const combined = combinedBody(envelope);
    const urlFound = trackingClient.extractTrackingFromUrls(combined);

    const narvarUrls = combined.match(NARVAR_URL_PATTERN) ?? [];
    for (const narvarUrl of narvarUrls.slice(0, 3)) {
      urlFound.push(...trackingClient.fetchNarvarTracking(narvarUrl));
    }

    const seenNumbers = new Set(found.map((r) => r.tracking_number));
    for (const result of urlFound) {
      if (!seenNumbers.has(result.tracking_number)) {
        seenNumbers.add(result.tracking_number);
        found.push(result);
      }
    }

    if (found.length === 0) return [];

    const added: string[] = [];
    for (const trackingInfo of found) {
      const { tracking_number: trackingNumber, carrier } = trackingInfo;
      const label = `${accountLabel}: ${senderName || senderEmail} - ${subject.slice(0, 40)}`;
      const result = trackingClient.addPackage(trackingNumber, carrier, label);
      if ("error" in result) {
        logger(`warn: failed to add package ${trackingNumber}: ${result["error"]}`);
        continue;
      }
      added.push(trackingNumber);
      logger(`📦 added package: ${trackingNumber} (${carrier}) — ${label}`);
    }

    return added;
  } catch (exc) {
    logger(`error: package tracking failed: ${exc}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// scanAndRemoveDelivered
// ---------------------------------------------------------------------------

export async function scanAndRemoveDelivered(
  envelope: MailEnvelope,
  options: {
    logger: (msg: string) => void;
    trackingClientLoader?: () => TrackingClient;
  },
): Promise<string[]> {
  const { logger, trackingClientLoader = loadTrackingClient } = options;
  const scanText = envelope.body_text || envelope.subject || "";

  try {
    const trackingClient = trackingClientLoader();
    const found = trackingClient.scanTextForTrackingNumbers(scanText);
    if (found.length === 0) {
      logger(`delivery email but no tracking number found: ${envelope.subject}`);
      return [];
    }

    const removed: string[] = [];
    for (const trackingInfo of found) {
      const { tracking_number: trackingNumber, carrier } = trackingInfo;
      const result = trackingClient.removePackage(trackingNumber);
      if ((result as Record<string, unknown>)["success"]) {
        removed.push(trackingNumber);
        logger(`✅ removed delivered package: ${trackingNumber} (${carrier})`);
      } else if ((result as Record<string, unknown>)["error"] === "not_found") {
        logger(`delivery notice for untracked package: ${trackingNumber} — ignoring`);
      } else {
        logger(`warn: failed to remove ${trackingNumber}: ${JSON.stringify(result)}`);
      }
    }

    return removed;
  } catch (exc) {
    logger(`error: delivery removal failed: ${exc}`);
    return [];
  }
}
