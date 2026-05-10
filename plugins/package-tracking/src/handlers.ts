/**
 * Package Tracking — core handlers.
 * Pure logic with no knowledge of how it's invoked.
 */
import {
  detectCarrier,
  getTrackingUrl,
  getPackage,
  addPackage,
  removePackage,
  listPackages,
  scanTextForTrackingNumbers,
  statusRegistry,
  builtinProviders,
  type CarrierStatusPlugin,
} from "@openclaw/package-tracking-core";

export { statusRegistry };

export interface PackageTrackingConfig {
  /** Paths to external ESM carrier status provider plugin modules to load at startup. */
  status_providers?: string[];
}

export async function loadProviders(providers: string[]): Promise<void> {
  // Register built-in providers first (USPS, FedEx, UPS)
  for (const provider of builtinProviders) {
    statusRegistry.register(provider);
  }
  console.log(`[package-tracking] registered ${builtinProviders.length} built-in providers`);

  // Then load any external/override providers (registered last = highest priority)
  for (const pluginPath of providers) {
    try {
      const mod = await import(pluginPath) as CarrierStatusPlugin;
      if (typeof mod.register !== "function") {
        console.warn(`[package-tracking] status provider ${pluginPath} does not export register() — skipping`);
        continue;
      }
      await mod.register(statusRegistry);
      console.log(`[package-tracking] loaded carrier status provider: ${pluginPath}`);
    } catch (e) {
      console.error(`[package-tracking] failed to load status provider ${pluginPath}: ${e}`);
    }
  }
}

export function handlePackageTrack(args: Record<string, unknown>): Record<string, unknown> {
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

export function handlePackageAdd(args: Record<string, unknown>): Record<string, unknown> {
  const trackingNumber = ((args.tracking_number as string) ?? "").trim();

  if (!trackingNumber) {
    return { error: "tracking_number is required" };
  }

  const carrier = (args.carrier as string | undefined) ?? undefined;
  const label = (args.label as string | undefined) ?? undefined;
  const orderId = (args.order_id as string | undefined) ?? undefined;

  const extra: Record<string, unknown> = {};
  if (orderId) extra.order_id = orderId;

  return addPackage(trackingNumber, carrier, label, Object.keys(extra).length ? extra : null);
}

export function handlePackageRemove(args: Record<string, unknown>): Record<string, unknown> {
  const trackingNumber = ((args.tracking_number as string) ?? "").trim();

  if (!trackingNumber) {
    return { error: "tracking_number is required" };
  }

  return removePackage(trackingNumber);
}

export function handlePackageList(): Record<string, unknown> {
  return listPackages();
}

export function handlePackageScan(args: Record<string, unknown>): Record<string, unknown> {
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

export async function handlePackageStatus(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const trackingNumber = ((args.tracking_number as string) ?? "").trim();

  if (!trackingNumber) {
    return { error: "tracking_number is required" };
  }

  const carrier = (args.carrier as string | undefined) ?? undefined;

  if (!statusRegistry.hasProviders) {
    return { error: "No carrier status providers are registered. Configure status_providers in plugin config." };
  }

  const result = await statusRegistry.getStatus(trackingNumber, carrier);
  if (!result) {
    return { error: `No status provider available for tracking number: ${trackingNumber}` };
  }
  return result as unknown as Record<string, unknown>;
}
