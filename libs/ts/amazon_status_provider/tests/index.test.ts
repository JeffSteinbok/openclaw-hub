/**
 * Tests for the Amazon status provider.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock getPackage from core
vi.mock("@openclaw/package-tracking-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openclaw/package-tracking-core")>();
  return { ...actual, getPackage: vi.fn() };
});

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { amazonProvider, register } = await import("../src/index.js");
const { getPackage } = await import("@openclaw/package-tracking-core");

describe("amazonProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct name and carriers", () => {
    expect(amazonProvider.name).toBe("Amazon Satellite");
    expect(amazonProvider.carriers).toEqual(["Amazon"]);
  });

  it("returns null when no order_id is stored", async () => {
    vi.mocked(getPackage).mockReturnValue({ error: "Package not found" });

    const result = await amazonProvider.getStatus("TBA123456789012US", "Amazon");
    expect(result).toBeNull();
  });

  it("returns null when satellite returns non-OK", async () => {
    vi.mocked(getPackage).mockReturnValue({
      tracking_number: "TBA123456789012US",
      carrier: "Amazon",
      order_id: "113-1234567-8901234",
    });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal error",
    });

    const result = await amazonProvider.getStatus("TBA123456789012US", "Amazon");
    expect(result).toBeNull();
  });

  it("maps satellite order response to CarrierStatusResult", async () => {
    vi.mocked(getPackage).mockReturnValue({
      tracking_number: "TBA123456789012US",
      carrier: "Amazon",
      order_id: "113-1234567-8901234",
    });

    const orderResponse = {
      order_id: "113-1234567-8901234",
      status: "Delivered",
      items: [{ name: "USB-C Cable" }, { name: "Phone Case" }],
      shipments: [
        {
          status: "Delivered to front door",
          last_update: "2026-05-08T14:30:00Z",
          expected_delivery: "May 8, 2026",
        },
      ],
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => orderResponse,
    });

    const result = await amazonProvider.getStatus("TBA123456789012US", "Amazon");
    expect(result).not.toBeNull();
    expect(result!.carrier).toBe("Amazon");
    expect(result!.status).toBe("Delivered");
    expect(result!.delivered).toBe(true);
    expect(result!.description).toBe("Delivered to front door");
    expect(result!.order_id).toBe("113-1234567-8901234");
  });

  it("uses item names as description when no shipment info", async () => {
    vi.mocked(getPackage).mockReturnValue({
      tracking_number: "TBA123456789012US",
      carrier: "Amazon",
      order_id: "113-9999999-0000000",
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        order_id: "113-9999999-0000000",
        status: "Shipped",
        items: [{ name: "Widget A" }, { name: "Widget B" }],
      }),
    });

    const result = await amazonProvider.getStatus("TBA123456789012US", "Amazon");
    expect(result).not.toBeNull();
    expect(result!.delivered).toBe(false);
    expect(result!.description).toBe("Widget A, Widget B");
  });

  it("register() adds provider to registry", () => {
    const mockRegistry = { register: vi.fn() };
    register(mockRegistry as any);
    expect(mockRegistry.register).toHaveBeenCalledWith(amazonProvider);
  });
});
