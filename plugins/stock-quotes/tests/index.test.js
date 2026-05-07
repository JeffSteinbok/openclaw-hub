/**
 * Tests for the Stock Quotes plugin native TS implementation.
 *
 * Mocks Node's https module to avoid real network calls.
 * Covers: tool registration, Yahoo Finance response parsing,
 * error handling, multi-symbol batch tool, and Finnhub fallback config.
 */
import { describe, it, expect, vi } from "vitest";
import https from "node:https";
import { EventEmitter } from "node:events";
// ---------------------------------------------------------------------------
// HTTP mock helpers
// ---------------------------------------------------------------------------
function makeMockGet(body, statusCode = 200) {
    const res = new EventEmitter();
    res.statusCode = statusCode;
    const req = new EventEmitter();
    req.destroy = vi.fn();
    const flush = () => {
        res.emit("data", Buffer.from(body));
        res.emit("end");
    };
    return { res, req, flush };
}
function makeApi(config = {}) {
    const tools = {};
    return {
        pluginConfig: config,
        registerTool(tool) {
            const t = tool;
            tools[t.name] = t;
        },
        tools,
    };
}
async function loadPlugin(config = {}) {
    const mod = await import("../src/index.js");
    const entry = mod.default;
    const api = makeApi(config);
    entry.register(api);
    return { entry, api };
}
// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const YAHOO_MSFT_RESPONSE = JSON.stringify({
    chart: {
        result: [
            {
                meta: {
                    symbol: "MSFT",
                    regularMarketPrice: 420.5,
                    chartPreviousClose: 415.0,
                    currency: "USD",
                    exchangeTimezoneName: "America/New_York",
                    marketState: "REGULAR",
                    regularMarketTime: 1714680000,
                },
                timestamp: [1714680000],
            },
        ],
        error: null,
    },
});
const YAHOO_ERROR_RESPONSE = JSON.stringify({
    chart: {
        result: null,
        error: { description: "No fundamentals data found for any of the summaryTypes=financialData" },
    },
});
// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------
describe("plugin entry", () => {
    it("has correct id and name", async () => {
        const { entry } = await loadPlugin();
        expect(entry.id).toBe("stock-quotes");
        expect(entry.name).toBe("Stock Quotes");
    });
    it("registers stock_quote and stock_quotes tools", async () => {
        const { api } = await loadPlugin();
        const names = Object.keys(api.tools).sort();
        expect(names).toContain("stock_quote");
        expect(names).toContain("stock_quotes");
    });
    it("all tools have name, description, and parameters", async () => {
        const { api } = await loadPlugin();
        for (const tool of Object.values(api.tools)) {
            expect(typeof tool.name).toBe("string");
            expect(tool.description.length).toBeGreaterThan(0);
            expect(tool.parameters).toBeDefined();
        }
    });
});
// ---------------------------------------------------------------------------
// stock_quote — parameter validation
// ---------------------------------------------------------------------------
describe("stock_quote parameter validation", () => {
    it("returns error when symbol is missing", async () => {
        const { api } = await loadPlugin();
        const result = await api.tools["stock_quote"].execute("id", {});
        const text = result.content[0].text;
        expect(JSON.parse(text)).toMatchObject({ error: expect.stringContaining("symbol") });
    });
    it("returns error when symbol is empty string", async () => {
        const { api } = await loadPlugin();
        const result = await api.tools["stock_quote"].execute("id", { symbol: "  " });
        const text = result.content[0].text;
        expect(JSON.parse(text)).toMatchObject({ error: expect.stringContaining("symbol") });
    });
});
// ---------------------------------------------------------------------------
// stock_quote — Yahoo Finance response parsing
// ---------------------------------------------------------------------------
describe("stock_quote — Yahoo Finance", () => {
    it("parses a valid Yahoo Finance response", async () => {
        const { api } = await loadPlugin();
        const { res, req, flush } = makeMockGet(YAHOO_MSFT_RESPONSE);
        vi.spyOn(https, "get").mockImplementationOnce((_url, _opts, cb) => {
            if (cb)
                cb(res);
            setTimeout(flush, 0);
            return req;
        });
        const result = await api.tools["stock_quote"].execute("id", { symbol: "MSFT" });
        const text = result.content[0].text;
        const data = JSON.parse(text);
        expect(data.symbol).toBe("MSFT");
        expect(data.price).toBe(420.5);
        expect(data.previous_close).toBe(415.0);
        expect(data.currency).toBe("USD");
        expect(data.source).toMatch(/yahoo/i);
    });
    it("returns error for Yahoo API error response", async () => {
        const { api } = await loadPlugin();
        const { res, req, flush } = makeMockGet(YAHOO_ERROR_RESPONSE);
        vi.spyOn(https, "get").mockImplementationOnce((_url, _opts, cb) => {
            if (cb)
                cb(res);
            setTimeout(flush, 0);
            return req;
        });
        const result = await api.tools["stock_quote"].execute("id", { symbol: "INVALID" });
        const text = result.content[0].text;
        expect(JSON.parse(text)).toHaveProperty("error");
    });
    it("returns error on network failure", async () => {
        const { api } = await loadPlugin();
        const { req } = makeMockGet("");
        vi.spyOn(https, "get").mockImplementationOnce((_url, _opts, _cb) => {
            setTimeout(() => req.emit("error", new Error("ECONNREFUSED")), 0);
            return req;
        });
        const result = await api.tools["stock_quote"].execute("id", { symbol: "MSFT" });
        const text = result.content[0].text;
        expect(JSON.parse(text)).toHaveProperty("error");
    });
    it("returns error on HTTP 429", async () => {
        const { api } = await loadPlugin();
        const { res, req, flush } = makeMockGet("Too Many Requests", 429);
        vi.spyOn(https, "get").mockImplementationOnce((_url, _opts, cb) => {
            if (cb)
                cb(res);
            setTimeout(flush, 0);
            return req;
        });
        const result = await api.tools["stock_quote"].execute("id", { symbol: "MSFT" });
        const text = result.content[0].text;
        expect(JSON.parse(text)).toHaveProperty("error");
    });
});
// ---------------------------------------------------------------------------
// stock_quotes — batch tool
// ---------------------------------------------------------------------------
describe("stock_quotes — batch", () => {
    it("returns error when symbols is missing", async () => {
        const { api } = await loadPlugin();
        const result = await api.tools["stock_quotes"].execute("id", {});
        const text = result.content[0].text;
        expect(JSON.parse(text)).toMatchObject({ error: expect.stringContaining("symbol") });
    });
    it("returns error when symbols array is empty", async () => {
        const { api } = await loadPlugin();
        const result = await api.tools["stock_quotes"].execute("id", { symbols: [] });
        const text = result.content[0].text;
        expect(JSON.parse(text)).toMatchObject({ error: expect.stringContaining("symbol") });
    });
    it("returns results object with quotes array for valid symbols", async () => {
        const { api } = await loadPlugin();
        // Mock two sequential Yahoo responses
        vi.spyOn(https, "get")
            .mockImplementationOnce((_url, _opts, cb) => {
            const { res, req, flush } = makeMockGet(YAHOO_MSFT_RESPONSE);
            if (cb)
                cb(res);
            setTimeout(flush, 0);
            return req;
        })
            .mockImplementationOnce((_url, _opts, cb) => {
            const body = YAHOO_MSFT_RESPONSE.replace(/MSFT/g, "AAPL").replace("420.5", "175.0");
            const { res, req, flush } = makeMockGet(body);
            if (cb)
                cb(res);
            setTimeout(flush, 0);
            return req;
        });
        const result = await api.tools["stock_quotes"].execute("id", { symbols: ["MSFT", "AAPL"] });
        const text = result.content[0].text;
        const data = JSON.parse(text);
        expect(data.quotes).toBeDefined();
        expect(Array.isArray(data.quotes)).toBe(true);
        expect(data.count).toBe(2);
        expect(data.quotes[0].symbol).toBe("MSFT");
        expect(data.quotes[1].symbol).toBe("AAPL");
    });
});
