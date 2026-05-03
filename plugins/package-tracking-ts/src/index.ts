/**
 * Package Tracking plugin — pure TS-native implementation.
 *
 * Wraps @openclaw/package-tracking-core to expose 5 tools for tracking
 * packages from UPS, FedEx, USPS, and Amazon.
 */

import { Type } from "@sinclair/typebox";
import {
  detectCarrier,
  getTrackingUrl,
  getPackage,
  addPackage,
  removePackage,
  listPackages,
  scanTextForTrackingNumbers,
} from "@openclaw/package-tracking-core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PluginApi = {
  registerTool: (tool: unknown) => void;
  pluginConfig?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data) }],
    details: {},
  };
}

// ---------------------------------------------------------------------------
// Handlers (match Python logic exactly)
// ---------------------------------------------------------------------------

function handlePackageTrack(args: Record<string, unknown>): Record<string, unknown> {
  const trackingNumber = ((args.tracking_number as string) ?? "").trim();

  if (!trackingNumber) {
    return { error: "tracking_number is required" };
  }

  const carrierArg = (args.carrier as string | undefined) ?? undefined;

  // Try to get from saved packages first
  const pkg = getPackage(trackingNumber);
  if (!("error" in pkg)) {
    return pkg;
  }

  // Not saved, try to detect carrier and generate URL
  let carrier = carrierArg;
  if (!carrier) {
    carrier = detectCarrier(trackingNumber) ?? undefined;
  }

  if (!carrier) {
    return {
      error: `Could not detect carrier for tracking number: ${trackingNumber}. Please specify carrier (UPS, FedEx, USPS, Amazon) manually.`,
    };
  }

  const url = getTrackingUrl(trackingNumber, carrier);
  if (!url) {
    return { error: `Could not generate tracking URL for carrier: ${carrier}` };
  }

  return {
    tracking_number: trackingNumber.toUpperCase(),
    carrier,
    url,
    saved: false,
  };
}

function handlePackageAdd(args: Record<string, unknown>): Record<string, unknown> {
  const trackingNumber = ((args.tracking_number as string) ?? "").trim();

  if (!trackingNumber) {
    return { error: "tracking_number is required" };
  }

  const carrier = (args.carrier as string | undefined) ?? undefined;
  const label = (args.label as string | undefined) ?? undefined;

  return addPackage(trackingNumber, carrier, label);
}

function handlePackageRemove(args: Record<string, unknown>): Record<string, unknown> {
  const trackingNumber = ((args.tracking_number as string) ?? "").trim();

  if (!trackingNumber) {
    return { error: "tracking_number is required" };
  }

  return removePackage(trackingNumber);
}

function handlePackageList(): Record<string, unknown> {
  return listPackages();
}

function handlePackageScan(args: Record<string, unknown>): Record<string, unknown> {
  const text = (args.text as string) ?? "";

  if (!text) {
    return { error: "text is required" };
  }

  const results = scanTextForTrackingNumbers(text);

  return {
    tracking_numbers: results,
    count: results.length,
  };
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

function createEntry() {
  return {
    id: "package-tracking",
    name: "Package Tracking",
    description: "Track packages from UPS, FedEx, USPS, and Amazon",
    configSchema: { type: "object" as const, additionalProperties: false, properties: {} },
    register(api: PluginApi) {
      api.registerTool({
        name: "package_track",
        label: "Track Package",
        description:
          "Look up a package by tracking number and return the carrier and tracking URL.",
        parameters: Type.Object({
          tracking_number: Type.String({
            description:
              "Package tracking number (e.g., 1Z999AA10123456784, 940000000000000000000, TBA012345678901US)",
          }),
          carrier: Type.Optional(
            Type.String({
              description: "Optional carrier override: UPS, FedEx, USPS, or Amazon",
            }),
          ),
        }),
        execute(_toolCallId: string, params: Record<string, unknown>) {
          return formatResult(handlePackageTrack(params));
        },
      });

      api.registerTool({
        name: "package_add",
        label: "Add Package",
        description: "Save a package to the tracking list, with an optional label.",
        parameters: Type.Object({
          tracking_number: Type.String({
            description: "Package tracking number",
          }),
          carrier: Type.Optional(
            Type.String({
              description: "Optional carrier override: UPS, FedEx, USPS, or Amazon",
            }),
          ),
          label: Type.Optional(
            Type.String({
              description: "Optional label/description for the package",
            }),
          ),
        }),
        execute(_toolCallId: string, params: Record<string, unknown>) {
          return formatResult(handlePackageAdd(params));
        },
      });

      api.registerTool({
        name: "package_remove",
        label: "Remove Package",
        description: "Remove a saved package from the tracking list.",
        parameters: Type.Object({
          tracking_number: Type.String({
            description: "Package tracking number to remove",
          }),
        }),
        execute(_toolCallId: string, params: Record<string, unknown>) {
          return formatResult(handlePackageRemove(params));
        },
      });

      api.registerTool({
        name: "package_list",
        label: "List Packages",
        description:
          "List saved packages with carriers, tracking URLs, labels, and added dates.",
        parameters: Type.Object({}),
        execute(_toolCallId: string, params: Record<string, unknown>) {
          return formatResult(handlePackageList());
        },
      });

      api.registerTool({
        name: "package_scan",
        label: "Scan for Tracking Numbers",
        description: "Scan text for package tracking numbers and identify their carriers.",
        parameters: Type.Object({
          text: Type.String({
            description: "Text to scan for tracking numbers (e.g., email body)",
          }),
        }),
        execute(_toolCallId: string, params: Record<string, unknown>) {
          return formatResult(handlePackageScan(params));
        },
      });
    },
  };
}

export { createEntry };
