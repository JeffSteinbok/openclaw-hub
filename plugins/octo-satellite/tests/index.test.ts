import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

type ToolDef = { name: string; execute: (id: string, params: Record<string, unknown>) => Promise<unknown> };

function makeApi(config: Record<string, unknown> = {}) {
  const tools: Record<string, ToolDef> = {};
  return {
    pluginConfig: { ...config },
    registerTool(t: unknown) { tools[(t as ToolDef).name] = t as ToolDef; },
    tools,
  };
}

async function loadPlugin(config: Record<string, unknown> = {}) {
  const { createEntry } = await import("../src/index.js");
  const entry = createEntry();
  const api = makeApi(config);
  entry.register(api);
  return { entry, api };
}

afterEach(() => vi.restoreAllMocks());

describe("satellite plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("amazon_list_orders", () => {
    it("returns orders from satellite", async () => {
      const { api } = await loadPlugin({ token: "test-token", baseUrl: "http://localhost:9000" });
      const fakeResponse = {
        orders: [{ id: "113-111-222", date: "2026-05-01", total: "$29.99", status: "Delivered", items: ["Widget"] }],
        total: 1,
        page: 1,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => fakeResponse,
      });

      const result = await api.tools.amazon_list_orders.execute("call1", {});
      const parsed = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
      expect(parsed.orders).toHaveLength(1);
      expect(parsed.orders[0].id).toBe("113-111-222");
    });

    it("passes page parameter", async () => {
      const { api } = await loadPlugin({ token: "test-token", baseUrl: "http://localhost:9000" });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ orders: [], total: 0, page: 2 }),
      });

      await api.tools.amazon_list_orders.execute("call1b", { page: 2 });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("page=2");
    });

    it("returns error on fetch failure", async () => {
      const { api } = await loadPlugin({ token: "test-token", baseUrl: "http://localhost:9000" });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        text: async () => "down",
      });

      const result = await api.tools.amazon_list_orders.execute("call2", {});
      const parsed = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
      expect(parsed.error).toContain("503");
    });
  });

  describe("amazon_get_order", () => {
    it("returns order details", async () => {
      const { api } = await loadPlugin({ token: "test-token", baseUrl: "http://localhost:9000" });
      const fakeOrder = {
        id: "113-111-222",
        status: "Shipped",
        items: [{ title: "Widget", quantity: 1, price: "$29.99" }],
        tracking: [{ carrier: "UPS", tracking_number: "1Z999AA10123456784", status: "In Transit" }],
      };
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => fakeOrder });

      const result = await api.tools.amazon_get_order.execute("call3", { order_id: "113-111-222" });
      const parsed = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
      expect(parsed.id).toBe("113-111-222");
      expect(parsed.tracking[0].carrier).toBe("UPS");
    });

    it("errors when order_id is missing", async () => {
      const { api } = await loadPlugin({ token: "test-token", baseUrl: "http://localhost:9000" });
      const result = await api.tools.amazon_get_order.execute("call4", {});
      const parsed = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
      expect(parsed.error).toBe("order_id is required");
    });
  });

  describe("amazon_search", () => {
    it("searches products", async () => {
      const { api } = await loadPlugin({ token: "test-token", baseUrl: "http://localhost:9000" });
      const fakeResults = { results: [{ asin: "B0TEST", title: "Test Product", price: "$9.99" }] };
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => fakeResults });

      const result = await api.tools.amazon_search.execute("call7", { q: "test widget" });
      const parsed = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
      expect(parsed.results[0].asin).toBe("B0TEST");
    });

    it("errors when q is missing", async () => {
      const { api } = await loadPlugin({ token: "test-token", baseUrl: "http://localhost:9000" });
      const result = await api.tools.amazon_search.execute("call8", {});
      const parsed = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
      expect(parsed.error).toContain("q");
    });
  });

  describe("amazon_get_product", () => {
    it("returns product details", async () => {
      const { api } = await loadPlugin({ token: "test-token", baseUrl: "http://localhost:9000" });
      const fakeProduct = { asin: "B0TEST", title: "Widget", price: "$19.99", rating: 4.5 };
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => fakeProduct });

      const result = await api.tools.amazon_get_product.execute("call9", { asin: "B0TEST" });
      const parsed = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
      expect(parsed.asin).toBe("B0TEST");
      expect(parsed.rating).toBe(4.5);
    });
  });

  describe("amazon_get_cart", () => {
    it("returns cart contents", async () => {
      const { api } = await loadPlugin({ token: "test-token", baseUrl: "http://localhost:9000" });
      const fakeCart = { items: [{ item_id: "abc", title: "Widget", quantity: 1 }] };
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => fakeCart });

      const result = await api.tools.amazon_get_cart.execute("call10", {});
      const parsed = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
      expect(parsed.items[0].item_id).toBe("abc");
    });
  });

  describe("amazon_add_to_cart", () => {
    it("adds item to cart", async () => {
      const { api } = await loadPlugin({ token: "test-token", baseUrl: "http://localhost:9000" });
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });

      const result = await api.tools.amazon_add_to_cart.execute("call11", { asin: "B0TEST" });
      const parsed = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
      expect(parsed.success).toBe(true);
      expect(mockFetch.mock.calls[0][1].method).toBe("POST");
    });
  });

  describe("amazon_remove_from_cart", () => {
    it("removes item from cart", async () => {
      const { api } = await loadPlugin({ token: "test-token", baseUrl: "http://localhost:9000" });
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });

      const result = await api.tools.amazon_remove_from_cart.execute("call12", { item_id: "abc" });
      const parsed = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
      expect(parsed.success).toBe(true);
      expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
    });
  });

  describe("monarch_get_accounts", () => {
    it("returns accounts grouped by type", async () => {
      const { api } = await loadPlugin({ token: "test-token", baseUrl: "http://localhost:9000" });
      const fakeAccounts = {
        provider: "monarch",
        accounts: {
          Investments: { total: 100000, accounts: [{ name: "401k", balance: 100000, institution: "Fidelity", last_updated: "2026-05-05" }] },
        },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => fakeAccounts,
      });

      const result = await api.tools.monarch_get_accounts.execute("call5", {});
      const parsed = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
      expect(parsed.provider).toBe("monarch");
      expect(parsed.accounts.Investments.total).toBe(100000);
    });
  });

  describe("monarch_get_net_worth", () => {
    it("returns net worth summary", async () => {
      const { api } = await loadPlugin({ token: "test-token", baseUrl: "http://localhost:9000" });
      const fakeNetWorth = { provider: "monarch", assets: 500000, liabilities: 100000, net_worth: 400000 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => fakeNetWorth,
      });

      const result = await api.tools.monarch_get_net_worth.execute("call6", {});
      const parsed = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
      expect(parsed.net_worth).toBe(400000);
      expect(parsed.assets).toBe(500000);
    });

    it("passes an explicit date range", async () => {
      const { api } = await loadPlugin({ token: "test-token", baseUrl: "http://localhost:9000" });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ provider: "monarch", snapshots: [] }),
      });

      await api.tools.monarch_get_net_worth.execute("call6b", {
        start_date: "2026-01-01",
        end_date: "2026-01-31",
      });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/monarch/net-worth?start_date=2026-01-01&end_date=2026-01-31");
    });
  });

  describe("monarch_get_spending", () => {
    it("returns spending trends with default months", async () => {
      const { api } = await loadPlugin({ token: "test-token", baseUrl: "http://localhost:9000" });
      const fakeSpending = {
        provider: "monarch",
        months: [
          { month: "2026-04", income: 8000, expenses: 5000, savings: 3000 },
          { month: "2026-03", income: 8000, expenses: 4500, savings: 3500 },
          { month: "2026-02", income: 8000, expenses: 6000, savings: 2000 },
        ],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => fakeSpending,
      });

      const result = await api.tools.monarch_get_spending.execute("call7", {});
      const parsed = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
      expect(parsed.provider).toBe("monarch");
      expect(parsed.months).toHaveLength(3);
      expect(mockFetch.mock.calls[0][0]).toContain("/monarch/spending?months=3");
    });

    it("passes custom months parameter", async () => {
      const { api } = await loadPlugin({ token: "test-token", baseUrl: "http://localhost:9000" });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ provider: "monarch", months: [] }),
      });

      await api.tools.monarch_get_spending.execute("call8", { months: 6 });
      expect(mockFetch.mock.calls[0][0]).toContain("/monarch/spending?months=6");
    });

    it("passes an explicit date range instead of months", async () => {
      const { api } = await loadPlugin({ token: "test-token", baseUrl: "http://localhost:9000" });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ provider: "monarch", months: [] }),
      });

      await api.tools.monarch_get_spending.execute("call8b", {
        months: 6,
        start_date: "2026-01-01",
        end_date: "2026-01-31",
      });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/monarch/spending?start_date=2026-01-01&end_date=2026-01-31");
      expect(url).not.toContain("months=");
    });
  });

  describe("monarch_login", () => {
    it("starts interactive login on the satellite", async () => {
      const { api } = await loadPlugin({ token: "test-token", baseUrl: "http://localhost:9000" });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ provider: "monarch", status: "login_started" }),
      });

      const result = await api.tools.monarch_login.execute("call-login", {});
      const parsed = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
      expect(parsed.status).toBe("login_started");
      expect(mockFetch.mock.calls[0][0]).toContain("/monarch/login");
      expect(mockFetch.mock.calls[0][1].method).toBe("POST");
    });
  });

  describe("monarch_get_merchants", () => {
    it("passes date, category, and limit filters", async () => {
      const { api } = await loadPlugin({ token: "test-token", baseUrl: "http://localhost:9000" });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ provider: "monarch", merchants: [] }),
      });

      await api.tools.monarch_get_merchants.execute("call-merchants", {
        months: 6,
        start_date: "2026-01-01",
        end_date: "2026-01-31",
        category: "Travel & Lifestyle",
        limit: 10,
      });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain(
        "/monarch/merchants?start_date=2026-01-01&end_date=2026-01-31&category=Travel+%26+Lifestyle&limit=10",
      );
      expect(url).not.toContain("months=");
    });

    it("uses the default lookback when no date range is provided", async () => {
      const { api } = await loadPlugin({ token: "test-token", baseUrl: "http://localhost:9000" });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ provider: "monarch", merchants: [] }),
      });

      await api.tools.monarch_get_merchants.execute("call-merchants-default", {});
      expect(mockFetch.mock.calls[0][0]).toContain("/monarch/merchants?months=3");
    });
  });

  describe("monarch_get_health", () => {
    it("returns health status", async () => {
      const { api } = await loadPlugin({ token: "test-token", baseUrl: "http://localhost:9000" });
      const fakeHealth = { provider: "monarch", status: "authenticated" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => fakeHealth,
      });

      const result = await api.tools.monarch_get_health.execute("call9", {});
      const parsed = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
      expect(parsed.status).toBe("authenticated");
      expect(mockFetch.mock.calls[0][0]).toContain("/monarch/health");
    });
  });

  describe("monarch_get_sync_status", () => {
    it("returns sync status for accounts", async () => {
      const { api } = await loadPlugin({ token: "test-token", baseUrl: "http://localhost:9000" });
      const fakeSyncStatus = {
        provider: "monarch",
        accounts: [
          { name: "Chase Checking", last_synced: "2026-05-09T10:00:00Z", status: "healthy" },
        ],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => fakeSyncStatus,
      });

      const result = await api.tools.monarch_get_sync_status.execute("call10", {});
      const parsed = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
      expect(parsed.accounts).toHaveLength(1);
      expect(parsed.accounts[0].status).toBe("healthy");
      expect(mockFetch.mock.calls[0][0]).toContain("/monarch/sync-status");
    });
  });

  describe("monarch_refresh_accounts", () => {
    it("triggers account refresh", async () => {
      const { api } = await loadPlugin({ token: "test-token", baseUrl: "http://localhost:9000" });
      const fakeRefresh = { provider: "monarch", status: "refresh_requested" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => fakeRefresh,
      });

      const result = await api.tools.monarch_refresh_accounts.execute("call11", {});
      const parsed = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
      expect(parsed.status).toBe("refresh_requested");
      expect(mockFetch.mock.calls[0][0]).toContain("/monarch/refresh");
      expect(mockFetch.mock.calls[0][1].method).toBe("POST");
    });
  });
});
