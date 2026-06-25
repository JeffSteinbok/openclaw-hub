/**
 * Octo Satellite plugin — OpenClaw plugin shim.
 *
 * Constructs config from pluginConfig, registers tools that delegate to handlers.
 */

import { definePlugin } from "carapace-plugin-sdk";
import { Type } from "@sinclair/typebox";
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

export const createEntry = definePlugin({
  id: "octo-satellite",
  name: "Octo Satellite",
  description:
    "Interface to Octo Satellite local proxy. Amazon orders and Monarch Money finances.",

  configSchema: Type.Object({
    token: Type.Optional(
      Type.String({ description: "Satellite API bearer token" }),
    ),
    baseUrl: Type.Optional(
      Type.String({
        description: "Satellite base URL (default: http://localhost:9000)",
      }),
    ),
  }),

  tools: (tool) => [
    tool({
      name: "amazon_list_orders",
      label: "List Amazon Orders",
      description:
        "List or search Amazon orders with pagination (10 per page). " +
        "Optionally filter by search query. " +
        "Returns order id, date, total, status, item titles, total count, and pagination info.",
      parameters: Type.Object({
        q: Type.Optional(
          Type.String({ description: "Optional search query to filter orders" }),
        ),
        page: Type.Optional(
          Type.Integer({
            description: "Page number, 1-based (default: 1, 10 orders per page)",
          }),
        ),
      }),
      async execute({ q, page }, config) {
        const satelliteConfig: SatelliteConfig = {
          token: config.token?.trim() || process.env.OCTO_SATELLITE_TOKEN?.trim() || undefined,
          baseUrl: config.baseUrl?.trim() || "http://localhost:9000",
        };
        return await amazonListOrders({
          q: q?.trim() || undefined,
          page: page != null ? Number(page) : undefined,
        }, satelliteConfig);
      },
    }),

    tool({
      name: "amazon_get_order",
      label: "Get Amazon Order Details",
      description:
        "Get full details and tracking info for a specific Amazon order. " +
        "Returns items, quantities, prices, shipping address, and carrier tracking.",
      parameters: Type.Object({
        order_id: Type.String({
          description: "Amazon order ID (e.g. 113-1234567-8901234)",
        }),
      }),
      async execute({ order_id }, config) {
        const orderId = order_id?.trim();
        if (!orderId) return { error: "order_id is required" };

        const satelliteConfig: SatelliteConfig = {
          token: config.token?.trim() || process.env.OCTO_SATELLITE_TOKEN?.trim() || undefined,
          baseUrl: config.baseUrl?.trim() || "http://localhost:9000",
        };
        return await amazonGetOrder({ order_id: orderId }, satelliteConfig);
      },
    }),

    tool({
      name: "amazon_search",
      label: "Search Amazon Products",
      description:
        "Search Amazon products by query string. Returns product titles, prices, " +
        "ratings, ASINs, and pagination info.",
      parameters: Type.Object({
        q: Type.String({ description: "Search query" }),
        page: Type.Optional(
          Type.Integer({ description: "Page number, 1-based (default: 1)" }),
        ),
      }),
      async execute({ q, page }, config) {
        const query = q?.trim();
        if (!query) return { error: "q (search query) is required" };

        const satelliteConfig: SatelliteConfig = {
          token: config.token?.trim() || process.env.OCTO_SATELLITE_TOKEN?.trim() || undefined,
          baseUrl: config.baseUrl?.trim() || "http://localhost:9000",
        };
        return await amazonSearch({
          q: query,
          page: page != null ? Number(page) : undefined,
        }, satelliteConfig);
      },
    }),

    tool({
      name: "amazon_get_product",
      label: "Get Amazon Product",
      description:
        "Get product details by ASIN. Returns title, price, rating, features, " +
        "availability, and more.",
      parameters: Type.Object({
        asin: Type.String({
          description: "Amazon product identifier (e.g. B0FQFB8FMG)",
        }),
      }),
      async execute({ asin }, config) {
        const trimmedAsin = asin.trim();
        if (!trimmedAsin) return { error: "asin is required" };

        const satelliteConfig: SatelliteConfig = {
          token: config.token?.trim() || process.env.OCTO_SATELLITE_TOKEN?.trim() || undefined,
          baseUrl: config.baseUrl?.trim() || "http://localhost:9000",
        };
        return await amazonGetProduct({ asin: trimmedAsin }, satelliteConfig);
      },
    }),

    tool({
      name: "amazon_get_cart",
      label: "View Amazon Cart",
      description: "View current Amazon cart contents.",
      parameters: Type.Object({}),
      async execute(_params, config) {
        const satelliteConfig: SatelliteConfig = {
          token: config.token?.trim() || process.env.OCTO_SATELLITE_TOKEN?.trim() || undefined,
          baseUrl: config.baseUrl?.trim() || "http://localhost:9000",
        };
        return await amazonGetCart(satelliteConfig);
      },
    }),

    tool({
      name: "amazon_add_to_cart",
      label: "Add to Amazon Cart",
      description: "Add a product to the Amazon cart by ASIN.",
      parameters: Type.Object({
        asin: Type.String({
          description: "Amazon product identifier (e.g. B0FQFB8FMG)",
        }),
      }),
      async execute({ asin }, config) {
        const trimmedAsin = asin.trim();
        if (!trimmedAsin) return { error: "asin is required" };

        const satelliteConfig: SatelliteConfig = {
          token: config.token?.trim() || process.env.OCTO_SATELLITE_TOKEN?.trim() || undefined,
          baseUrl: config.baseUrl?.trim() || "http://localhost:9000",
        };
        return await amazonAddToCart({ asin: trimmedAsin }, satelliteConfig);
      },
    }),

    tool({
      name: "amazon_remove_from_cart",
      label: "Remove from Amazon Cart",
      description:
        "Remove an item from the Amazon cart by item_id " +
        "(the ephemeral cart item ID from amazon_get_cart).",
      parameters: Type.Object({
        item_id: Type.String({
          description: "Cart item ID (from amazon_get_cart response)",
        }),
      }),
      async execute({ item_id }, config) {
        const itemId = item_id.trim();
        if (!itemId) return { error: "item_id is required" };

        const satelliteConfig: SatelliteConfig = {
          token: config.token?.trim() || process.env.OCTO_SATELLITE_TOKEN?.trim() || undefined,
          baseUrl: config.baseUrl?.trim() || "http://localhost:9000",
        };
        return await amazonRemoveFromCart({ item_id: itemId }, satelliteConfig);
      },
    }),

    tool({
      name: "monarch_get_accounts",
      label: "Get Monarch Accounts",
      description:
        "Get financial accounts and balances from Monarch Money, grouped by type " +
        "(Investments, Cash, Credit Cards, etc). Each account shows name, balance, " +
        "institution, and last updated timestamp.",
      parameters: Type.Object({}),
      async execute(_params, config) {
        const satelliteConfig: SatelliteConfig = {
          token: config.token?.trim() || process.env.OCTO_SATELLITE_TOKEN?.trim() || undefined,
          baseUrl: config.baseUrl?.trim() || "http://localhost:9000",
        };
        return await monarchGetAccounts(satelliteConfig);
      },
    }),

    tool({
      name: "monarch_get_net_worth",
      label: "Get Net Worth",
      description:
        "Get net worth summary from Monarch Money. " +
        "Returns total assets, total liabilities, and net worth.",
      parameters: Type.Object({}),
      async execute(_params, config) {
        const satelliteConfig: SatelliteConfig = {
          token: config.token?.trim() || process.env.OCTO_SATELLITE_TOKEN?.trim() || undefined,
          baseUrl: config.baseUrl?.trim() || "http://localhost:9000",
        };
        return await monarchGetNetWorth(satelliteConfig);
      },
    }),

    tool({
      name: "monarch_get_spending",
      label: "Get Spending Trends",
      description:
        "Get spending trends from Monarch Money — income, expenses, and savings " +
        "broken down by month. Defaults to the last 3 months.",
      parameters: Type.Object({
        months: Type.Optional(
          Type.Integer({ description: "Number of months to look back (default: 3)" }),
        ),
      }),
      async execute({ months }, config) {
        const satelliteConfig: SatelliteConfig = {
          token: config.token?.trim() || process.env.OCTO_SATELLITE_TOKEN?.trim() || undefined,
          baseUrl: config.baseUrl?.trim() || "http://localhost:9000",
        };
        return await monarchGetSpending({
          months: months != null ? Number(months) : undefined,
        }, satelliteConfig);
      },
    }),

    tool({
      name: "monarch_get_health",
      label: "Monarch Health Check",
      description:
        "Verify Monarch Money session is authenticated and the connection is healthy.",
      parameters: Type.Object({}),
      async execute(_params, config) {
        const satelliteConfig: SatelliteConfig = {
          token: config.token?.trim() || process.env.OCTO_SATELLITE_TOKEN?.trim() || undefined,
          baseUrl: config.baseUrl?.trim() || "http://localhost:9000",
        };
        return await monarchGetHealth(satelliteConfig);
      },
    }),

    tool({
      name: "monarch_get_sync_status",
      label: "Monarch Sync Status",
      description:
        "Get sync status for all linked Monarch Money accounts — last synced time, " +
        "institution health, and connection state for each account.",
      parameters: Type.Object({}),
      async execute(_params, config) {
        const satelliteConfig: SatelliteConfig = {
          token: config.token?.trim() || process.env.OCTO_SATELLITE_TOKEN?.trim() || undefined,
          baseUrl: config.baseUrl?.trim() || "http://localhost:9000",
        };
        return await monarchGetSyncStatus(satelliteConfig);
      },
    }),

    tool({
      name: "monarch_refresh_accounts",
      label: "Refresh Monarch Accounts",
      description:
        "Trigger an account refresh with all linked Monarch Money institutions. " +
        "Fire-and-forget — returns immediately after requesting the refresh. " +
        "Use monarch_get_sync_status to check progress afterward.",
      parameters: Type.Object({}),
      async execute(_params, config) {
        const satelliteConfig: SatelliteConfig = {
          token: config.token?.trim() || process.env.OCTO_SATELLITE_TOKEN?.trim() || undefined,
          baseUrl: config.baseUrl?.trim() || "http://localhost:9000",
        };
        return await monarchRefreshAccounts(satelliteConfig);
      },
    }),

    tool({
      name: "monarch_get_investments",
      label: "Get Investment Holdings",
      description:
        "Get investment account positions (holdings) from Monarch Money. " +
        "Optionally filter to a single account by account_id. " +
        "Returns positions with ticker, shares, value, and cost basis.",
      parameters: Type.Object({
        account_id: Type.Optional(
          Type.Integer({
            description:
              "Monarch account ID to filter to (optional — omit for all investment accounts)",
          }),
        ),
      }),
      async execute({ account_id }, config) {
        const satelliteConfig: SatelliteConfig = {
          token: config.token?.trim() || process.env.OCTO_SATELLITE_TOKEN?.trim() || undefined,
          baseUrl: config.baseUrl?.trim() || "http://localhost:9000",
        };
        return await monarchGetInvestments({
          account_id: account_id != null ? Number(account_id) : undefined,
        }, satelliteConfig);
      },
    }),
  ],
});
