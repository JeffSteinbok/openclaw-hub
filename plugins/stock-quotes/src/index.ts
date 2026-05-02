/**
 * Stock Quotes plugin — pure TS-native implementation.
 *
 * Fetches stock, ETF, and mutual fund quotes from Yahoo Finance (no auth)
 * with optional Finnhub fallback when an API key is configured.
 */

import https from "node:https";
import http from "node:http";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StockQuote {
  symbol: string;
  price: number | null;
  previous_close: number | null;
  change: number | null;
  change_percent: number | null;
  currency: string;
  market_state: string;
  timezone: string;
  timestamp: string | null;
  source: string;
}

interface PluginApi {
  registerTool: (tool: unknown) => void;
  pluginConfig?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function httpGet(url: string, headers?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { headers, timeout: 10_000 }, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}

// ---------------------------------------------------------------------------
// Yahoo Finance client
// ---------------------------------------------------------------------------

const YAHOO_API_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

async function fetchYahooQuote(symbol: string): Promise<StockQuote | { error: string }> {
  const url = `${YAHOO_API_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  try {
    const raw = await httpGet(url, { "User-Agent": "Mozilla/5.0" });
    const data = JSON.parse(raw);

    const chartError = data?.chart?.error;
    if (!data?.chart || chartError) {
      const msg =
        typeof chartError === "object" && chartError
          ? chartError.description ?? "Unknown error"
          : String(chartError);
      return { error: `Yahoo Finance API error: ${msg}` };
    }

    const chartResult = data.chart.result;
    if (!chartResult?.length) return { error: `No data found for symbol ${symbol}` };

    const meta = chartResult[0].meta ?? {};
    if (!meta) return { error: `No metadata found for symbol ${symbol}` };

    const currentPrice: number | null = meta.regularMarketPrice ?? null;
    const previousClose: number | null = meta.chartPreviousClose ?? null;

    let change: number | null = null;
    let changePercent: number | null = null;
    if (currentPrice != null && previousClose != null && previousClose !== 0) {
      change = Math.round((currentPrice - previousClose) * 100) / 100;
      changePercent =
        Math.round(((currentPrice - previousClose) / previousClose) * 10000) / 100;
    }

    let timestamp: string | null = null;
    if (meta.regularMarketTime) {
      timestamp = new Date(meta.regularMarketTime * 1000).toISOString().replace("+00:00", "Z");
    }

    return {
      symbol: symbol.toUpperCase(),
      price: currentPrice,
      previous_close: previousClose,
      change,
      change_percent: changePercent,
      currency: meta.currency ?? "USD",
      market_state: meta.marketState ?? "REGULAR",
      timezone: meta.exchangeTimezoneName ?? "America/New_York",
      timestamp,
      source: "yahoo_finance",
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("HTTP 404")) return { error: `Symbol ${symbol} not found` };
    return { error: `Failed to fetch quote: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// Finnhub client
// ---------------------------------------------------------------------------

const FINNHUB_API_BASE = "https://finnhub.io/api/v1";

async function fetchFinnhubQuote(
  symbol: string,
  apiKey: string,
): Promise<StockQuote | { error: string }> {
  const url = `${FINNHUB_API_BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`;
  try {
    const raw = await httpGet(url);
    const data = JSON.parse(raw);

    const currentPrice = data.c;
    if (currentPrice === 0) {
      return { error: `No data found for symbol ${symbol} (may not be supported by Finnhub)` };
    }

    return {
      symbol: symbol.toUpperCase(),
      price: currentPrice,
      previous_close: data.pc ?? null,
      change: data.d ?? null,
      change_percent: data.dp ?? null,
      currency: "USD",
      market_state: "REGULAR",
      timezone: "America/New_York",
      timestamp: new Date().toISOString(),
      source: "finnhub",
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("HTTP 401")) return { error: "Invalid Finnhub API key" };
    return { error: `Failed to fetch quote: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

async function getStockQuote(
  symbol: string,
  finnhubApiKey?: string,
): Promise<StockQuote | { error: string }> {
  symbol = symbol.trim().toUpperCase();
  if (!symbol) return { error: "Symbol is required" };

  if (finnhubApiKey) {
    const result = await fetchFinnhubQuote(symbol, finnhubApiKey);
    if (!("error" in result)) return result;
    // Finnhub failed — fall back to Yahoo
  }
  return fetchYahooQuote(symbol);
}

async function getStockQuotes(
  symbols: string[],
  finnhubApiKey?: string,
): Promise<{ quotes: StockQuote[]; errors: { symbol: string; error: string }[] | null; count: number }> {
  const quotes: StockQuote[] = [];
  const errors: { symbol: string; error: string }[] = [];

  // Fetch in parallel for speed
  const results = await Promise.all(
    symbols.map((s) => getStockQuote(s, finnhubApiKey)),
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if ("error" in r) {
      errors.push({ symbol: symbols[i].toUpperCase(), error: r.error });
    } else {
      quotes.push(r);
    }
  }

  return { quotes, errors: errors.length ? errors : null, count: quotes.length };
}

// ---------------------------------------------------------------------------
// TypeBox schema helper (same as framework's toTSchema)
// ---------------------------------------------------------------------------

function toTSchema(jsonSchema: Record<string, unknown>): unknown {
  const schema = { ...jsonSchema } as Record<string | symbol, unknown>;
  schema[Symbol.for("TypeBox.Kind")] = "Object";
  schema[Symbol.for("TypeBox.Type")] = "Object";
  if (!schema.properties) schema.properties = {};
  return schema;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    finnhubApiKey: { type: "string" as const, description: "Optional Finnhub API key for premium data" },
  },
};

function formatResult(data: unknown) {
  return {
    content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data) }],
    details: {},
  };
}

const plugin = {
  id: "stock-quotes",
  name: "Stock Quotes",
  description: "Fetch current stock, ETF, and mutual fund quotes",
  configSchema,
  register(api: PluginApi) {
    const getFinnhubKey = () =>
      ((api.pluginConfig?.finnhubApiKey as string) ?? "").trim() || undefined;

    api.registerTool({
      name: "stock_quote",
      label: "Stock Quote",
      description:
        "Get the latest quote for a stock, ETF, or mutual fund symbol.",
      parameters: toTSchema({
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description: "Stock ticker symbol (e.g., AAPL, GOOGL, QQQ, FXAIX)",
          },
        },
        required: ["symbol"],
        additionalProperties: false,
      }),
      async execute(_toolCallId: string, params: Record<string, unknown>) {
        const symbol = ((params.symbol as string) ?? "").trim();
        if (!symbol) return formatResult({ error: "symbol is required" });
        return formatResult(await getStockQuote(symbol, getFinnhubKey()));
      },
    });

    api.registerTool({
      name: "stock_quotes",
      label: "Stock Quotes",
      description:
        "Get the latest quotes for multiple stock, ETF, or mutual fund symbols.",
      parameters: toTSchema({
        type: "object",
        properties: {
          symbols: {
            type: "array",
            items: { type: "string" },
            description:
              "Array of stock ticker symbols (e.g., ['MSFT', 'QQQ', 'FXAIX'])",
            minItems: 1,
          },
        },
        required: ["symbols"],
        additionalProperties: false,
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
        return formatResult(await getStockQuotes(symbols as string[], getFinnhubKey()));
      },
    });
  },
};

export default plugin;
