/**
 * Octo Satellite plugin — OpenClaw plugin shim.
 *
 * Constructs config from pluginConfig, registers tools that delegate to handlers.
 */

import {
  amazonListOrders,
  amazonGetOrder,
  amazonSearch,
  amazonGetProduct,
  amazonGetCart,
  amazonAddToCart,
  amazonRemoveFromCart,
  monarchGetAccounts,
  monarchGetNetWorth,
  monarchGetSpending,
  monarchGetHealth,
  monarchGetSyncStatus,
  monarchGetInvestments,
  monarchRefreshAccounts,
  type SatelliteConfig,
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
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: {},
  };
}

function buildConfig(pluginConfig?: Record<string, unknown>): SatelliteConfig {
  const configToken = ((pluginConfig?.token as string) ?? "").trim();
  const token = configToken || (process.env.OCTO_SATELLITE_TOKEN ?? "").trim() || undefined;
  const baseUrl = ((pluginConfig?.baseUrl as string) ?? "").trim() || "http://localhost:9000";
  return { token, baseUrl };
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    token: {
      type: "string" as const,
      description: "Satellite API bearer token",
    },
    baseUrl: {
      type: "string" as const,
      description: "Satellite base URL (default: http://localhost:9000)",
    },
  },
};

function createEntry() {
  return {
    id: "octo-satellite",
    name: "Octo Satellite",
    description:
      "Interface to Octo Satellite local proxy. Amazon orders and Monarch Money finances.",
    configSchema,
    register(api: PluginApi) {
      const config = buildConfig(api.pluginConfig);

      // ------------------------------------------------------------------
      // amazon_list_orders
      // ------------------------------------------------------------------
      api.registerTool({
        name: "amazon_list_orders",
        label: "List Amazon Orders",
        description:
          "List or search Amazon orders with pagination (10 per page). " +
          "Optionally filter by search query. " +
          "Returns order id, date, total, status, item titles, total count, and pagination info.",
        parameters: {
          type: "object",
          properties: {
            q: {
              type: "string",
              description: "Optional search query to filter orders",
            },
            page: {
              type: "integer",
              description: "Page number, 1-based (default: 1, 10 orders per page)",
            },
          },
          required: [],
          additionalProperties: false,
        },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const result = await amazonListOrders({
            q: ((params.q as string) ?? "").trim() || undefined,
            page: params.page ? Number(params.page) : undefined,
          }, config);
          return formatResult(result);
        },
      });

      // ------------------------------------------------------------------
      // amazon_get_order
      // ------------------------------------------------------------------
      api.registerTool({
        name: "amazon_get_order",
        label: "Get Amazon Order Details",
        description:
          "Get full details and tracking info for a specific Amazon order. " +
          "Returns items, quantities, prices, shipping address, and carrier tracking.",
        parameters: {
          type: "object",
          properties: {
            order_id: {
              type: "string",
              description: "Amazon order ID (e.g. 113-1234567-8901234)",
            },
          },
          required: ["order_id"],
          additionalProperties: false,
        },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const orderId = ((params.order_id as string) ?? "").trim();
          if (!orderId) return formatResult({ error: "order_id is required" });

          const result = await amazonGetOrder({ order_id: orderId }, config);
          return formatResult(result);
        },
      });

      // ------------------------------------------------------------------
      // amazon_search
      // ------------------------------------------------------------------
      api.registerTool({
        name: "amazon_search",
        label: "Search Amazon Products",
        description:
          "Search Amazon products by query string. Returns product titles, prices, " +
          "ratings, ASINs, and pagination info.",
        parameters: {
          type: "object",
          properties: {
            q: { type: "string", description: "Search query" },
            page: {
              type: "integer",
              description: "Page number, 1-based (default: 1)",
            },
          },
          required: ["q"],
          additionalProperties: false,
        },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const q = ((params.q as string) ?? "").trim();
          if (!q) return formatResult({ error: "q (search query) is required" });

          const result = await amazonSearch({
            q,
            page: params.page ? Number(params.page) : undefined,
          }, config);
          return formatResult(result);
        },
      });

      // ------------------------------------------------------------------
      // amazon_get_product
      // ------------------------------------------------------------------
      api.registerTool({
        name: "amazon_get_product",
        label: "Get Amazon Product",
        description:
          "Get product details by ASIN. Returns title, price, rating, features, " +
          "availability, and more.",
        parameters: {
          type: "object",
          properties: {
            asin: {
              type: "string",
              description: "Amazon product identifier (e.g. B0FQFB8FMG)",
            },
          },
          required: ["asin"],
          additionalProperties: false,
        },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const asin = ((params.asin as string) ?? "").trim();
          if (!asin) return formatResult({ error: "asin is required" });

          const result = await amazonGetProduct({ asin }, config);
          return formatResult(result);
        },
      });

      // ------------------------------------------------------------------
      // amazon_get_cart
      // ------------------------------------------------------------------
      api.registerTool({
        name: "amazon_get_cart",
        label: "View Amazon Cart",
        description: "View current Amazon cart contents.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        async execute(_toolCallId: string, _params: Record<string, unknown>) {
          const result = await amazonGetCart(config);
          return formatResult(result);
        },
      });

      // ------------------------------------------------------------------
      // amazon_add_to_cart
      // ------------------------------------------------------------------
      api.registerTool({
        name: "amazon_add_to_cart",
        label: "Add to Amazon Cart",
        description: "Add a product to the Amazon cart by ASIN.",
        parameters: {
          type: "object",
          properties: {
            asin: {
              type: "string",
              description: "Amazon product identifier (e.g. B0FQFB8FMG)",
            },
          },
          required: ["asin"],
          additionalProperties: false,
        },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const asin = ((params.asin as string) ?? "").trim();
          if (!asin) return formatResult({ error: "asin is required" });

          const result = await amazonAddToCart({ asin }, config);
          return formatResult(result);
        },
      });

      // ------------------------------------------------------------------
      // amazon_remove_from_cart
      // ------------------------------------------------------------------
      api.registerTool({
        name: "amazon_remove_from_cart",
        label: "Remove from Amazon Cart",
        description:
          "Remove an item from the Amazon cart by item_id " +
          "(the ephemeral cart item ID from amazon_get_cart).",
        parameters: {
          type: "object",
          properties: {
            item_id: {
              type: "string",
              description: "Cart item ID (from amazon_get_cart response)",
            },
          },
          required: ["item_id"],
          additionalProperties: false,
        },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const itemId = ((params.item_id as string) ?? "").trim();
          if (!itemId) return formatResult({ error: "item_id is required" });

          const result = await amazonRemoveFromCart({ item_id: itemId }, config);
          return formatResult(result);
        },
      });

      // ------------------------------------------------------------------
      // monarch_get_accounts
      // ------------------------------------------------------------------
      api.registerTool({
        name: "monarch_get_accounts",
        label: "Get Monarch Accounts",
        description:
          "Get financial accounts and balances from Monarch Money, grouped by type " +
          "(Investments, Cash, Credit Cards, etc). Each account shows name, balance, " +
          "institution, and last updated timestamp.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        async execute(_toolCallId: string, _params: Record<string, unknown>) {
          const result = await monarchGetAccounts(config);
          return formatResult(result);
        },
      });

      // ------------------------------------------------------------------
      // monarch_get_net_worth
      // ------------------------------------------------------------------
      api.registerTool({
        name: "monarch_get_net_worth",
        label: "Get Net Worth",
        description:
          "Get net worth summary from Monarch Money. " +
          "Returns total assets, total liabilities, and net worth.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        async execute(_toolCallId: string, _params: Record<string, unknown>) {
          const result = await monarchGetNetWorth(config);
          return formatResult(result);
        },
      });

      // ------------------------------------------------------------------
      // monarch_get_spending
      // ------------------------------------------------------------------
      api.registerTool({
        name: "monarch_get_spending",
        label: "Get Spending Trends",
        description:
          "Get spending trends from Monarch Money — income, expenses, and savings " +
          "broken down by month. Defaults to the last 3 months.",
        parameters: {
          type: "object",
          properties: {
            months: {
              type: "integer",
              description: "Number of months to look back (default: 3)",
            },
          },
          required: [],
          additionalProperties: false,
        },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const result = await monarchGetSpending({
            months: params.months ? Number(params.months) : undefined,
          }, config);
          return formatResult(result);
        },
      });

      // ------------------------------------------------------------------
      // monarch_get_health
      // ------------------------------------------------------------------
      api.registerTool({
        name: "monarch_get_health",
        label: "Monarch Health Check",
        description:
          "Verify Monarch Money session is authenticated and the connection is healthy.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        async execute(_toolCallId: string, _params: Record<string, unknown>) {
          const result = await monarchGetHealth(config);
          return formatResult(result);
        },
      });

      // ------------------------------------------------------------------
      // monarch_get_sync_status
      // ------------------------------------------------------------------
      api.registerTool({
        name: "monarch_get_sync_status",
        label: "Monarch Sync Status",
        description:
          "Get sync status for all linked Monarch Money accounts — last synced time, " +
          "institution health, and connection state for each account.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        async execute(_toolCallId: string, _params: Record<string, unknown>) {
          const result = await monarchGetSyncStatus(config);
          return formatResult(result);
        },
      });

      // ------------------------------------------------------------------
      // monarch_refresh_accounts
      // ------------------------------------------------------------------
      api.registerTool({
        name: "monarch_refresh_accounts",
        label: "Refresh Monarch Accounts",
        description:
          "Trigger an account refresh with all linked Monarch Money institutions. " +
          "Fire-and-forget — returns immediately after requesting the refresh. " +
          "Use monarch_get_sync_status to check progress afterward.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        async execute(_toolCallId: string, _params: Record<string, unknown>) {
          const result = await monarchRefreshAccounts(config);
          return formatResult(result);
        },
      });

      // ------------------------------------------------------------------
      // monarch_get_investments
      // ------------------------------------------------------------------
      api.registerTool({
        name: "monarch_get_investments",
        label: "Get Investment Holdings",
        description:
          "Get investment account positions (holdings) from Monarch Money. " +
          "Optionally filter to a single account by account_id. " +
          "Returns positions with ticker, shares, value, and cost basis.",
        parameters: {
          type: "object",
          properties: {
            account_id: {
              type: "integer",
              description:
                "Monarch account ID to filter to (optional — omit for all investment accounts)",
            },
          },
          required: [],
          additionalProperties: false,
        },
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const result = await monarchGetInvestments({
            account_id: params.account_id != null ? Number(params.account_id) : undefined,
          }, config);
          return formatResult(result);
        },
      });
    },
  };
}

export { createEntry };
export default createEntry();

