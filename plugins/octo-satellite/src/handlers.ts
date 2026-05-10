/**
 * Octo Satellite — core handlers.
 *
 * Pure logic with no knowledge of how it's invoked (plugin vs CLI).
 * Config is passed in; handlers never read env vars or plugin APIs directly.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SatelliteConfig {
  token?: string;
  baseUrl?: string;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function satelliteFetch(config: SatelliteConfig, path: string, method = "GET"): Promise<unknown> {
  const baseUrl = config.baseUrl || "http://localhost:9000";
  const url = new URL(path, baseUrl);

  const headers: Record<string, string> = { "Accept": "application/json" };
  if (config.token) headers["Authorization"] = `Bearer ${config.token}`;

  const res = await fetch(url.toString(), {
    method,
    headers,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Satellite ${res.status}: ${body || res.statusText}`);
  }

  return res.json();
}

async function withErrorCatch<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg };
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function amazonListOrders(
  params: { q?: string; page?: number },
  config: SatelliteConfig,
): Promise<unknown> {
  return withErrorCatch(async () => {
    const page = params.page ?? 1;
    const q = (params.q ?? "").trim();
    let path = `/amazon/orders?page=${page}`;
    if (q) path += `&q=${encodeURIComponent(q)}`;
    return await satelliteFetch(config, path);
  });
}

export async function amazonGetOrder(
  params: { order_id: string },
  config: SatelliteConfig,
): Promise<unknown> {
  return withErrorCatch(async () => {
    return await satelliteFetch(
      config,
      `/amazon/orders/${encodeURIComponent(params.order_id)}`
    );
  });
}

export async function amazonSearch(
  params: { q: string; page?: number },
  config: SatelliteConfig,
): Promise<unknown> {
  return withErrorCatch(async () => {
    const page = params.page ?? 1;
    return await satelliteFetch(
      config,
      `/amazon/search?q=${encodeURIComponent(params.q)}&page=${page}`
    );
  });
}

export async function amazonGetProduct(
  params: { asin: string },
  config: SatelliteConfig,
): Promise<unknown> {
  return withErrorCatch(async () => {
    return await satelliteFetch(
      config,
      `/amazon/items/${encodeURIComponent(params.asin)}`
    );
  });
}

export async function amazonGetCart(
  config: SatelliteConfig,
): Promise<unknown> {
  return withErrorCatch(async () => {
    return await satelliteFetch(config, "/amazon/cart");
  });
}

export async function amazonAddToCart(
  params: { asin: string },
  config: SatelliteConfig,
): Promise<unknown> {
  return withErrorCatch(async () => {
    return await satelliteFetch(
      config,
      `/amazon/cart?asin=${encodeURIComponent(params.asin)}`,
      "POST"
    );
  });
}

export async function amazonRemoveFromCart(
  params: { item_id: string },
  config: SatelliteConfig,
): Promise<unknown> {
  return withErrorCatch(async () => {
    return await satelliteFetch(
      config,
      `/amazon/cart/${encodeURIComponent(params.item_id)}`,
      "DELETE"
    );
  });
}

export async function monarchGetAccounts(
  config: SatelliteConfig,
): Promise<unknown> {
  return withErrorCatch(async () => {
    return await satelliteFetch(config, "/monarch/accounts");
  });
}

export async function monarchGetNetWorth(
  config: SatelliteConfig,
): Promise<unknown> {
  return withErrorCatch(async () => {
    return await satelliteFetch(config, "/monarch/net-worth");
  });
}

export async function monarchGetSpending(
  params: { months?: number },
  config: SatelliteConfig,
): Promise<unknown> {
  return withErrorCatch(async () => {
    const months = params.months ?? 3;
    return await satelliteFetch(config, `/monarch/spending?months=${months}`);
  });
}

export async function monarchGetHealth(
  config: SatelliteConfig,
): Promise<unknown> {
  return withErrorCatch(async () => {
    return await satelliteFetch(config, "/monarch/health");
  });
}

export async function monarchGetSyncStatus(
  config: SatelliteConfig,
): Promise<unknown> {
  return withErrorCatch(async () => {
    return await satelliteFetch(config, "/monarch/sync-status");
  });
}

export async function monarchRefreshAccounts(
  config: SatelliteConfig,
): Promise<unknown> {
  return withErrorCatch(async () => {
    return await satelliteFetch(config, "/monarch/refresh", "POST");
  });
}
