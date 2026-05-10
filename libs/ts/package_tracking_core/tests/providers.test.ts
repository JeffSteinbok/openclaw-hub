/**
 * Tests for the built-in carrier status providers.
 *
 * Unit tests mock the Python subprocess. Live integration tests are gated
 * behind RUN_LIVE_TRACKING_TESTS=1.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as child_process from "node:child_process";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof child_process>();
  return { ...actual, spawn: vi.fn() };
});

const { uspsProvider, fedexProvider, upsProvider, builtinProviders } = await import(
  "../src/providers/index.js"
);

function createMockProcess(stdout: string, stderr = "", exitCode = 0) {
  const proc = new EventEmitter() as any;
  proc.stdout = Readable.from([Buffer.from(stdout)]);
  proc.stderr = Readable.from([Buffer.from(stderr)]);
  proc.stdin = { end: vi.fn() };
  setTimeout(() => proc.emit("close", exitCode), 10);
  return proc;
}

describe("built-in providers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("exports three separate providers", () => {
    expect(builtinProviders).toHaveLength(3);
    expect(uspsProvider.name).toBe("USPS");
    expect(uspsProvider.carriers).toEqual(["USPS"]);
    expect(fedexProvider.name).toBe("FedEx");
    expect(fedexProvider.carriers).toEqual(["FEDEX"]);
    expect(upsProvider.name).toBe("UPS");
    expect(upsProvider.carriers).toEqual(["UPS"]);
  });

  it("USPS provider returns null for non-USPS carrier", async () => {
    const result = await uspsProvider.getStatus("1Z999AA10123456784", "UPS");
    expect(result).toBeNull();
  });

  it("FedEx provider returns null for non-FedEx carrier", async () => {
    const result = await fedexProvider.getStatus("9400111899223456789012", "USPS");
    expect(result).toBeNull();
  });

  it("returns null for invalid tracking number format", async () => {
    const result = await uspsProvider.getStatus("X", "USPS");
    expect(result).toBeNull();
  });

  it("USPS provider parses successful Python output", async () => {
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

    const result = await uspsProvider.getStatus("9400111899223456789012", "USPS");
    expect(result).not.toBeNull();
    expect(result!.status).toBe("Delivered");
    expect(result!.delivered).toBe(true);
    expect(result!.carrier).toBe("USPS");
    expect(result!.events).toBeDefined();
  });

  it("UPS provider handles carrier alias", async () => {
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

    const result = await upsProvider.getStatus("1Z999AA10123456784", "United Parcel Service");
    expect(result).not.toBeNull();
    expect(result!.carrier).toBe("UPS");
  });

  it("returns null when Python returns error envelope", async () => {
    const envelope = {
      ok: false,
      error: { code: "BOT_CHALLENGE", message: "Bot challenge detected" },
    };

    vi.mocked(child_process.spawn).mockReturnValue(
      createMockProcess(JSON.stringify(envelope)),
    );

    const result = await uspsProvider.getStatus("9400111899223456789012", "USPS");
    expect(result).toBeNull();
  });

  it("returns null when Python outputs invalid JSON", async () => {
    vi.mocked(child_process.spawn).mockReturnValue(
      createMockProcess("not json at all"),
    );

    const result = await fedexProvider.getStatus("522048729814000", "FedEx");
    expect(result).toBeNull();
  });
});

// Live integration tests — only run with RUN_LIVE_TRACKING_TESTS=1
const runLive = process.env.RUN_LIVE_TRACKING_TESTS === "1";

describe.skipIf(!runLive)("live tracking (slow)", () => {
  it("tracks a USPS package", async () => {
    const result = await uspsProvider.getStatus("9400111899223456789012", "USPS");
    console.log("USPS result:", JSON.stringify(result, null, 2));
    if (result) {
      expect(result.carrier).toBe("USPS");
      expect(typeof result.status).toBe("string");
    }
  }, 60_000);
});
