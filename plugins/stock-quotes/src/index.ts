/**
 * Stock Quotes plugin — OpenClaw plugin shim.
 *
 * Constructs config from pluginConfig, registers tools that delegate to handlers.
 */

import { Type } from "@sinclair/typebox";
import { getStockQuote, getStockQuotes, type StockQuotesConfig } from "./handlers.js";

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

function buildConfig(pluginConfig?: Record<string, unknown>): StockQuotesConfig {
  return {
    finnhubApiKey: ((pluginConfig?.finnhubApiKey as string) ?? "").trim() || undefined,
  };
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    finnhubApiKey: { type: "string" as const, description: "Optional Finnhub API key for premium data" },
  },
};

function createEntry() {
  return {
    id: "stock-quotes",
    name: "Stock Quotes",
    description: "Fetch current stock, ETF, and mutual fund quotes",
    contracts: { tools: ["stock_quote", "stock_quotes"] },
    configSchema,
    register(api: PluginApi) {
      const config = buildConfig(api.pluginConfig);

      api.registerTool({
        name: "stock_quote",
        label: "Stock Quote",
        description:
          "Get the latest quote for a stock, ETF, or mutual fund symbol.",
        parameters: Type.Object({
          symbol: Type.String({ description: "Stock ticker symbol (e.g., AAPL, GOOGL, QQQ, FXAIX)" }),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const symbol = ((params.symbol as string) ?? "").trim();
          if (!symbol) return formatResult({ error: "symbol is required" });
          return formatResult(await getStockQuote(symbol, config));
        },
      });

      api.registerTool({
        name: "stock_quotes",
        label: "Stock Quotes",
        description:
          "Get the latest quotes for multiple stock, ETF, or mutual fund symbols.",
        parameters: Type.Object({
          symbols: Type.Array(Type.String(), {
            description: "Array of stock ticker symbols (e.g., ['MSFT', 'QQQ', 'FXAIX'])",
            minItems: 1,
          }),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const symbols = params.symbols;
          if (!Array.isArray(symbols) || symbols.length === 0) {
            return formatResult({ error: "symbols array is required and must not be empty" });
          }
          for (const s of symbols) {
            if (typeof s !== "string") {
              return formatResult({ error: "All symbols must be strings" });
            }
          }
          return formatResult(await getStockQuotes(symbols as string[], config));
        },
      });
    },
  };
}

export { createEntry };
