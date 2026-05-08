/**
 * Package Tracking plugin — pure TS-native implementation.
 *
 * Wraps @openclaw/package-tracking-core to expose 5 tools for tracking
 * packages from UPS, FedEx, USPS, and Amazon.
 */

import { Type } from "@sinclair/typebox";
import {
  statusRegistry,
  loadProviders,
  handlePackageTrack,
  handlePackageAdd,
  handlePackageRemove,
  handlePackageList,
  handlePackageScan,
  handlePackageStatus,
  type PackageTrackingConfig,
} from "./handlers.js";

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
// Plugin entry
// ---------------------------------------------------------------------------

function createEntry() {
  return {
    id: "package-tracking",
    name: "Package Tracking",
    description: "Track packages from UPS, FedEx, USPS, and Amazon",
    contracts: { tools: ["package_list", "package_add", "package_remove", "package_track", "package_scan"] },
    configSchema: {
      type: "object" as const,
      additionalProperties: false,
      properties: {
        status_providers: {
          type: "array",
          items: { type: "string" },
          description: "Paths to external ESM carrier status provider plugin modules",
        },
      },
    },
    register(api: PluginApi) {
      // Load external carrier status provider plugins (deferred to avoid async during register)
      const config = (api.pluginConfig ?? {}) as PackageTrackingConfig;
      const statusProviders = config.status_providers ?? [];
      if (statusProviders.length > 0) {
        setImmediate(() => {
          void loadProviders(statusProviders);
        });
      }

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

      api.registerTool({
        name: "get_package_status",
        label: "Get Package Status",
        description:
          "Get live carrier status for a tracking number. Requires a carrier status provider to be configured via status_providers.",
        parameters: Type.Object({
          tracking_number: Type.String({
            description: "Package tracking number to check status for",
          }),
          carrier: Type.Optional(
            Type.String({
              description: "Optional carrier override: UPS, FedEx, USPS, or Amazon",
            }),
          ),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          return formatResult(await handlePackageStatus(params));
        },
      });
    },
  };
}

export { createEntry };
