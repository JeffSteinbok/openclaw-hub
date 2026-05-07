/**
 * Tests for the Package Tracking plugin TS-native implementation.
 *
 * Mocks @openclaw/package-tracking-core to avoid filesystem side effects.
 * Covers: tool registration, all 5 handlers, error cases, tool name matching.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the core library
// ---------------------------------------------------------------------------

vi.mock("@openclaw/package-tracking-core", () => ({
  detectCarrier: vi.fn(),
  getTrackingUrl: vi.fn(),
  getPackage: vi.fn(),
  addPackage: vi.fn(),
  removePackage: vi.fn(),
  listPackages: vi.fn(),
  scanTextForTrackingNumbers: vi.fn(),
}));

import {
  detectCarrier,
  getTrackingUrl,
  getPackage,
  addPackage,
  removePackage,
  listPackages,
  scanTextForTrackingNumbers,
} from "@openclaw/package-tracking-core";

const mockDetectCarrier = vi.mocked(detectCarrier);
const mockGetTrackingUrl = vi.mocked(getTrackingUrl);
const mockGetPackage = vi.mocked(getPackage);
const mockAddPackage = vi.mocked(addPackage);
const mockRemovePackage = vi.mocked(removePackage);
const mockListPackages = vi.mocked(listPackages);
const mockScanText = vi.mocked(scanTextForTrackingNumbers);

// ---------------------------------------------------------------------------
// Tool registration harness
// ---------------------------------------------------------------------------

interface ToolDef {
  name: string;
  description: string;
  parameters: unknown;
  execute: (id: string, params: Record<string, unknown>) => unknown;
}

function makeApi() {
  const tools: Record<string, ToolDef> = {};
  return {
    pluginConfig: {},
    registerTool(tool: unknown) {
      const t = tool as ToolDef;
      tools[t.name] = t;
    },
    tools,
  };
}

async function loadPlugin() {
  const { createEntry } = await import("../src/index.js");
  const entry = createEntry();
  const api = makeApi();
  entry.register(api);
  return { entry, api };
}

function parseResult(result: unknown): unknown {
  const text = (result as { content: Array<{ text: string }> }).content[0].text;
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

describe("plugin entry", () => {
  it("has correct id and name", async () => {
    const { entry } = await loadPlugin();
    expect(entry.id).toBe("package-tracking");
    expect(entry.name).toBe("Package Tracking");
  });

  it("registers all 5 tools", async () => {
    const { api } = await loadPlugin();
    const names = Object.keys(api.tools).sort();
    expect(names).toEqual([
      "package_add",
      "package_list",
      "package_remove",
      "package_scan",
      "package_track",
    ]);
  });

  it("tool names match the Python version exactly", async () => {
    const { api } = await loadPlugin();
    const expected = ["package_track", "package_add", "package_remove", "package_list", "package_scan"];
    for (const name of expected) {
      expect(api.tools[name]).toBeDefined();
    }
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
// package_track
// ---------------------------------------------------------------------------

describe("package_track", () => {
  it("returns error when tracking_number is missing", async () => {
    const { api } = await loadPlugin();
    const result = parseResult(api.tools["package_track"].execute("id", {}));
    expect(result).toMatchObject({ error: "tracking_number is required" });
  });

  it("returns error when tracking_number is empty", async () => {
    const { api } = await loadPlugin();
    const result = parseResult(api.tools["package_track"].execute("id", { tracking_number: "  " }));
    expect(result).toMatchObject({ error: "tracking_number is required" });
  });

  it("returns saved package when found", async () => {
    const savedPkg = {
      tracking_number: "1Z999AA10123456784",
      carrier: "UPS",
      url: "https://www.ups.com/track?tracknum=1Z999AA10123456784",
      label: "My Package",
      added_at: "2024-01-01T00:00:00.000Z",
    };
    mockGetPackage.mockReturnValue(savedPkg);

    const { api } = await loadPlugin();
    const result = parseResult(api.tools["package_track"].execute("id", { tracking_number: "1Z999AA10123456784" }));
    expect(result).toEqual(savedPkg);
  });

  it("detects carrier and returns URL when package not saved", async () => {
    mockGetPackage.mockReturnValue({ error: "Package not found: 1Z999AA10123456784" });
    mockDetectCarrier.mockReturnValue("UPS");
    mockGetTrackingUrl.mockReturnValue("https://www.ups.com/track?tracknum=1Z999AA10123456784");

    const { api } = await loadPlugin();
    const result = parseResult(api.tools["package_track"].execute("id", { tracking_number: "1Z999AA10123456784" }));
    expect(result).toMatchObject({
      tracking_number: "1Z999AA10123456784",
      carrier: "UPS",
      url: "https://www.ups.com/track?tracknum=1Z999AA10123456784",
      saved: false,
    });
  });

  it("uses carrier override when provided", async () => {
    mockGetPackage.mockReturnValue({ error: "Package not found" });
    mockGetTrackingUrl.mockReturnValue("https://www.fedex.com/fedextrack/?trknbr=123456789012");

    const { api } = await loadPlugin();
    const result = parseResult(
      api.tools["package_track"].execute("id", {
        tracking_number: "123456789012",
        carrier: "FedEx",
      }),
    );
    expect(result).toMatchObject({
      carrier: "FedEx",
      saved: false,
    });
    expect(mockDetectCarrier).not.toHaveBeenCalled();
  });

  it("returns error when carrier cannot be detected", async () => {
    mockGetPackage.mockReturnValue({ error: "Package not found" });
    mockDetectCarrier.mockReturnValue(null);

    const { api } = await loadPlugin();
    const result = parseResult(api.tools["package_track"].execute("id", { tracking_number: "UNKNOWN123" }));
    expect(result).toMatchObject({
      error: expect.stringContaining("Could not detect carrier"),
    });
  });

  it("returns error when tracking URL cannot be generated", async () => {
    mockGetPackage.mockReturnValue({ error: "Package not found" });
    mockDetectCarrier.mockReturnValue("UnknownCarrier");
    mockGetTrackingUrl.mockReturnValue(null);

    const { api } = await loadPlugin();
    const result = parseResult(api.tools["package_track"].execute("id", { tracking_number: "TEST123" }));
    expect(result).toMatchObject({
      error: expect.stringContaining("Could not generate tracking URL"),
    });
  });
});

// ---------------------------------------------------------------------------
// package_add
// ---------------------------------------------------------------------------

describe("package_add", () => {
  it("returns error when tracking_number is missing", async () => {
    const { api } = await loadPlugin();
    const result = parseResult(api.tools["package_add"].execute("id", {}));
    expect(result).toMatchObject({ error: "tracking_number is required" });
  });

  it("delegates to addPackage with all parameters", async () => {
    const added = {
      tracking_number: "1Z999AA10123456784",
      carrier: "UPS",
      url: "https://www.ups.com/track?tracknum=1Z999AA10123456784",
      label: "Birthday gift",
      added_at: "2024-01-01T00:00:00.000Z",
    };
    mockAddPackage.mockReturnValue(added);

    const { api } = await loadPlugin();
    const result = parseResult(
      api.tools["package_add"].execute("id", {
        tracking_number: "1Z999AA10123456784",
        carrier: "UPS",
        label: "Birthday gift",
      }),
    );
    expect(result).toEqual(added);
    expect(mockAddPackage).toHaveBeenCalledWith("1Z999AA10123456784", "UPS", "Birthday gift");
  });

  it("passes undefined for optional params when not provided", async () => {
    mockAddPackage.mockReturnValue({ tracking_number: "1Z999AA10123456784" });

    const { api } = await loadPlugin();
    api.tools["package_add"].execute("id", { tracking_number: "1Z999AA10123456784" });
    expect(mockAddPackage).toHaveBeenCalledWith("1Z999AA10123456784", undefined, undefined);
  });
});

// ---------------------------------------------------------------------------
// package_remove
// ---------------------------------------------------------------------------

describe("package_remove", () => {
  it("returns error when tracking_number is missing", async () => {
    const { api } = await loadPlugin();
    const result = parseResult(api.tools["package_remove"].execute("id", {}));
    expect(result).toMatchObject({ error: "tracking_number is required" });
  });

  it("delegates to removePackage and returns result", async () => {
    mockRemovePackage.mockReturnValue({ success: true, tracking_number: "1Z999AA10123456784" });

    const { api } = await loadPlugin();
    const result = parseResult(
      api.tools["package_remove"].execute("id", { tracking_number: "1Z999AA10123456784" }),
    );
    expect(result).toEqual({ success: true, tracking_number: "1Z999AA10123456784" });
  });

  it("returns error when package not found", async () => {
    mockRemovePackage.mockReturnValue({ error: "Package not found: UNKNOWN" });

    const { api } = await loadPlugin();
    const result = parseResult(
      api.tools["package_remove"].execute("id", { tracking_number: "UNKNOWN" }),
    );
    expect(result).toMatchObject({ error: expect.stringContaining("not found") });
  });
});

// ---------------------------------------------------------------------------
// package_list
// ---------------------------------------------------------------------------

describe("package_list", () => {
  it("returns empty list when no packages saved", async () => {
    mockListPackages.mockReturnValue({ packages: [], count: 0 });

    const { api } = await loadPlugin();
    const result = parseResult(api.tools["package_list"].execute("id", {}));
    expect(result).toEqual({ packages: [], count: 0 });
  });

  it("returns all saved packages", async () => {
    const packages = [
      {
        tracking_number: "1Z999AA10123456784",
        carrier: "UPS",
        url: "https://www.ups.com/track?tracknum=1Z999AA10123456784",
        label: "Package 1",
        added_at: "2024-01-01T00:00:00.000Z",
      },
    ];
    mockListPackages.mockReturnValue({ packages, count: 1 });

    const { api } = await loadPlugin();
    const result = parseResult(api.tools["package_list"].execute("id", {})) as { packages: unknown[]; count: number };
    expect(result.count).toBe(1);
    expect(result.packages).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// package_scan
// ---------------------------------------------------------------------------

describe("package_scan", () => {
  it("returns error when text is missing", async () => {
    const { api } = await loadPlugin();
    const result = parseResult(api.tools["package_scan"].execute("id", {}));
    expect(result).toMatchObject({ error: "text is required" });
  });

  it("returns error when text is empty", async () => {
    const { api } = await loadPlugin();
    const result = parseResult(api.tools["package_scan"].execute("id", { text: "" }));
    expect(result).toMatchObject({ error: "text is required" });
  });

  it("returns detected tracking numbers with count", async () => {
    const matches = [
      {
        tracking_number: "1Z999AA10123456784",
        carrier: "UPS",
        url: "https://www.ups.com/track?tracknum=1Z999AA10123456784",
      },
    ];
    mockScanText.mockReturnValue(matches);

    const { api } = await loadPlugin();
    const result = parseResult(
      api.tools["package_scan"].execute("id", {
        text: "Your package 1Z999AA10123456784 has shipped!",
      }),
    ) as { tracking_numbers: unknown[]; count: number };
    expect(result.count).toBe(1);
    expect(result.tracking_numbers).toEqual(matches);
  });

  it("returns empty list when no tracking numbers found", async () => {
    mockScanText.mockReturnValue([]);

    const { api } = await loadPlugin();
    const result = parseResult(
      api.tools["package_scan"].execute("id", { text: "No tracking numbers here." }),
    ) as { tracking_numbers: unknown[]; count: number };
    expect(result.count).toBe(0);
    expect(result.tracking_numbers).toEqual([]);
  });
});
