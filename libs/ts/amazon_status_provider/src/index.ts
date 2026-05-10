/**
 * Amazon carrier status provider via Octo Satellite proxy.
 *
 * Looks up the stored package's order_id, calls the satellite's
 * /amazon/orders/:id endpoint, and maps the response to a
 * CarrierStatusResult.
 *
 * Env vars:
 *   SATELLITE_BASE_URL — Base URL (default: http://localhost:9000)
 *   SATELLITE_TOKEN    — Optional bearer token
 */

import {
  getPackage,
  type CarrierStatusPlugin,
  type CarrierStatusProvider,
  type CarrierStatusResult,
  type StatusProviderRegistry,
} from "@openclaw/package-tracking-core";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getSatelliteConfig() {
  return {
    baseUrl: process.env.SATELLITE_BASE_URL ?? "http://localhost:9000",
    token: process.env.SATELLITE_TOKEN ?? "",
  };
}

// ---------------------------------------------------------------------------
// Satellite HTTP client
// ---------------------------------------------------------------------------

async function fetchOrder(orderId: string): Promise<Record<string, unknown> | null> {
  const { baseUrl, token } = getSatelliteConfig();
  const url = `${baseUrl}/amazon/orders/${encodeURIComponent(orderId)}`;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      console.error(`[amazon-provider] satellite ${res.status}: ${await res.text().catch(() => "")}`);
      return null;
    }
    return (await res.json()) as Record<string, unknown>;
  } catch (err) {
    console.error(`[amazon-provider] fetch error: ${err}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Response mapping
// ---------------------------------------------------------------------------

function mapOrderToStatus(
  trackingNumber: string,
  order: Record<string, unknown>,
): CarrierStatusResult {
  // The satellite returns order details with shipment/tracking info.
  // Field names depend on the satellite's Amazon scraper output.
  const status = (order.status as string) ?? (order.delivery_status as string) ?? "Unknown";
  const delivered = /\bdeliver/i.test(status);

  // Try to extract delivery/shipment details
  const items = order.items as Array<Record<string, unknown>> | undefined;
  const shipments = order.shipments as Array<Record<string, unknown>> | undefined;

  let description: string | null = null;
  let lastUpdate: string | null = null;
  let expectedDelivery: string | null = null;

  if (shipments && shipments.length > 0) {
    const shipment = shipments[0];
    description = (shipment.status as string) ?? null;
    lastUpdate = (shipment.last_update as string) ?? (shipment.date as string) ?? null;
    expectedDelivery = (shipment.expected_delivery as string) ?? (shipment.delivery_date as string) ?? null;
  }

  // Build item summary for description
  if (!description && items && items.length > 0) {
    const names = items.map((i) => i.name ?? i.title ?? "item").slice(0, 3);
    description = names.join(", ") + (items.length > 3 ? ` (+${items.length - 3} more)` : "");
  }

  return {
    tracking_number: trackingNumber,
    carrier: "Amazon",
    status,
    delivered,
    last_update: lastUpdate,
    description,
    ...(expectedDelivery ? { expected_delivery: expectedDelivery } : {}),
    ...(order.order_id ? { order_id: order.order_id } : {}),
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const amazonProvider: CarrierStatusProvider = {
  name: "Amazon Satellite",
  carriers: ["Amazon"],

  async getStatus(trackingNumber: string, _carrier?: string): Promise<CarrierStatusResult | null> {
    const tn = trackingNumber.trim().toUpperCase();

    // Look up stored package to find the order_id
    const pkg = getPackage(tn);
    const orderId = (pkg as Record<string, unknown>).order_id as string | undefined;

    if (!orderId) {
      console.error(`[amazon-provider] no order_id stored for tracking number ${tn}`);
      return null;
    }

    const order = await fetchOrder(orderId);
    if (!order) return null;

    return mapOrderToStatus(tn, order);
  },
};

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

export const register: CarrierStatusPlugin["register"] = (registry: StatusProviderRegistry) => {
  registry.register(amazonProvider);
};
