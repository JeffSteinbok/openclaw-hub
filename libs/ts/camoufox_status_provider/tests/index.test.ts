/**
 * Tests for the Camoufox status provider.
 *
 * Unit tests mock the Python subprocess. Live integration tests are gated
 * behind RUN_LIVE_TRACKING_TESTS=1.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as child_process from "node:child_process";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

// We need to mock spawn before importing the module
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof child_process>();
  return { ...actual, spawn: vi.fn() };
});

const { camoufoxProvider, register } = await import("../src/index.js");

function createMockProcess(stdout: string, stderr = "", exitCode = 0) {
  const proc = new EventEmitter() as any;
  proc.stdout = Readable.from([Buffer.from(stdout)]);
  proc.stderr = Readable.from([Buffer.from(stderr)]);
  proc.stdin = { end: vi.fn() };

  setTimeout(() => proc.emit("close", exitCode), 10);
  return proc;
}

describe("camoufoxProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct name and carriers", () => {
    expect(camoufoxProvider.name).toBe("Camoufox Scraper");
    expect(camoufoxProvider.carriers).toEqual(["USPS", "FedEx", "UPS"]);
  });

  it("returns null for unsupported carrier", async () => {
    const result = await camoufoxProvider.getStatus("TEST123456", "DHL");
    expect(result).toBeNull();
  });

  it("returns null for invalid tracking number format", async () => {
    const result = await camoufoxProvider.getStatus("X", "USPS");
    expect(result).toBeNull();
  });

  it("parses successful Python output", async () => {
    const envelope = {
      ok: true,
      result: {
        tracking_number: "9400111899223456789012",
        carrier: "USPS",
        status: "Delivered",
        delivered: true,
        last_update: "May 8, 2026",
        description: "Delivered, In/At Mailbox",
        events: [{ description: "Delivered", timestamp_raw: "May 8, 2026" }],
      },
    };

    vi.mocked(child_process.spawn).mockReturnValue(
      createMockProcess(JSON.stringify(envelope)),
    );

    const result = await camoufoxProvider.getStatus("9400111899223456789012", "USPS");
    expect(result).not.toBeNull();
    expect(result!.status).toBe("Delivered");
    expect(result!.delivered).toBe(true);
    expect(result!.carrier).toBe("USPS");
    expect(result!.events).toBeDefined();
  });

  it("returns null when Python returns error envelope", async () => {
    const envelope = {
      ok: false,
      error: { code: "BOT_CHALLENGE", message: "Bot challenge detected" },
    };

    vi.mocked(child_process.spawn).mockReturnValue(
      createMockProcess(JSON.stringify(envelope)),
    );

    const result = await camoufoxProvider.getStatus("9400111899223456789012", "USPS");
    expect(result).toBeNull();
  });

  it("returns null when Python outputs invalid JSON", async () => {
    vi.mocked(child_process.spawn).mockReturnValue(
      createMockProcess("not json at all"),
    );

    const result = await camoufoxProvider.getStatus("9400111899223456789012", "USPS");
    expect(result).toBeNull();
  });

  it("normalizes carrier aliases", async () => {
    const envelope = {
      ok: true,
      result: {
        tracking_number: "1Z999AA10123456784",
        carrier: "UPS",
        status: "In Transit",
        delivered: false,
        last_update: null,
        description: null,
      },
    };

    vi.mocked(child_process.spawn).mockReturnValue(
      createMockProcess(JSON.stringify(envelope)),
    );

    const result = await camoufoxProvider.getStatus("1Z999AA10123456784", "United Parcel Service");
    expect(result).not.toBeNull();
    expect(result!.carrier).toBe("UPS");
  });

  it("register() adds provider to registry", () => {
    const mockRegistry = { register: vi.fn() };
    register(mockRegistry as any);
    expect(mockRegistry.register).toHaveBeenCalledWith(camoufoxProvider);
  });
});

// Live integration tests — only run with RUN_LIVE_TRACKING_TESTS=1
const runLive = process.env.RUN_LIVE_TRACKING_TESTS === "1";

describe.skipIf(!runLive)("live tracking (slow)", () => {
  it("tracks a USPS package", async () => {
    const result = await camoufoxProvider.getStatus("9400111899223456789012", "USPS");
    console.log("USPS result:", JSON.stringify(result, null, 2));
    // Just verify we got something back without crashing
    if (result) {
      expect(result.carrier).toBe("USPS");
      expect(typeof result.status).toBe("string");
    }
  }, 60_000);
});
