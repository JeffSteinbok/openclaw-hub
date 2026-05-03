import { describe, it, expect, vi } from "vitest";
import {
  isDeliveryNotification,
  scanAndAddPackages,
  scanAndRemoveDelivered,
  type TrackingClient,
} from "../src/package-tracking.js";
import type { MailEnvelope } from "../src/runtime.js";

function envelope(overrides: Partial<MailEnvelope> = {}): MailEnvelope {
  return {
    message_id: "msg-1",
    provider: "test-provider",
    account_id: "acct-1",
    mailbox_id: "inbox",
    sender_name: "FedEx",
    sender_email: "tracking@fedex.com",
    subject: "Your package is on its way",
    ...overrides,
  };
}

function mockTrackingClient(overrides: {
  isShipping?: boolean;
  scanText?: Array<{ tracking_number: string; carrier: string }>;
  urlFound?: Array<{ tracking_number: string; carrier: string }>;
  narvar?: Array<{ tracking_number: string; carrier: string }>;
  addResult?: Record<string, unknown>;
  removeResult?: Record<string, unknown>;
} = {}): TrackingClient {
  return {
    isShippingSender: vi.fn().mockReturnValue(overrides.isShipping ?? true),
    scanTextForTrackingNumbers: vi.fn().mockReturnValue(overrides.scanText ?? []),
    extractTrackingFromUrls: vi.fn().mockReturnValue(overrides.urlFound ?? []),
    fetchNarvarTracking: vi.fn().mockReturnValue(overrides.narvar ?? []),
    addPackage: vi.fn().mockReturnValue(overrides.addResult ?? { success: true }),
    removePackage: vi.fn().mockReturnValue(overrides.removeResult ?? { success: true }),
  };
}

// ---------------------------------------------------------------------------
// isDeliveryNotification
// ---------------------------------------------------------------------------
describe("isDeliveryNotification", () => {
  it("positive delivered", () => {
    expect(isDeliveryNotification("Your package has been delivered")).toBe(true);
  });

  it("positive delivery complete", () => {
    expect(isDeliveryNotification("Delivery complete for order #123")).toBe(true);
  });

  it("negative", () => {
    expect(isDeliveryNotification("Your package is on its way")).toBe(false);
  });

  it("case insensitive", () => {
    expect(isDeliveryNotification("DELIVERED")).toBe(true);
  });

  it("empty subject", () => {
    expect(isDeliveryNotification("")).toBe(false);
  });

  it("null subject", () => {
    expect(isDeliveryNotification(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scanAndAddPackages
// ---------------------------------------------------------------------------
describe("scanAndAddPackages", () => {
  it("non shipping sender skip", async () => {
    const client = mockTrackingClient({ isShipping: false });
    const logger = vi.fn();
    const result = await scanAndAddPackages(envelope(), {
      accountLabel: "Test",
      logger,
      trackingClientLoader: () => client,
    });
    expect(result).toEqual([]);
    expect(logger).toHaveBeenCalledOnce();
    expect(logger.mock.calls[0][0]).toContain("non-shipping sender");
  });

  it("amazon sender skip", async () => {
    const client = mockTrackingClient();
    const logger = vi.fn();
    const result = await scanAndAddPackages(
      envelope({ sender_email: "orders@amazon.com" }),
      { accountLabel: "Test", logger, trackingClientLoader: () => client },
    );
    expect(result).toEqual([]);
    expect(logger.mock.calls[0][0]).toContain("Amazon");
  });

  it("amazon subdomain skip", async () => {
    const client = mockTrackingClient();
    const logger = vi.fn();
    const result = await scanAndAddPackages(
      envelope({ sender_email: "ship@notify.amazon.com" }),
      { accountLabel: "Test", logger, trackingClientLoader: () => client },
    );
    expect(result).toEqual([]);
  });

  it("found tracking added", async () => {
    const client = mockTrackingClient({
      scanText: [{ tracking_number: "1Z999", carrier: "UPS" }],
      addResult: { success: true },
    });
    const logger = vi.fn();
    const result = await scanAndAddPackages(
      envelope({ body_text: "Track 1Z999" }),
      { accountLabel: "MyAcct", logger, trackingClientLoader: () => client },
    );
    expect(result).toEqual(["1Z999"]);
    expect(client.addPackage).toHaveBeenCalledWith("1Z999", "UPS", expect.any(String));
  });

  it("no tracking found", async () => {
    const client = mockTrackingClient({ scanText: [], urlFound: [] });
    const logger = vi.fn();
    const result = await scanAndAddPackages(
      envelope({ body_text: "No numbers here" }),
      { accountLabel: "Test", logger, trackingClientLoader: () => client },
    );
    expect(result).toEqual([]);
  });

  it("add error logged", async () => {
    const client = mockTrackingClient({
      scanText: [{ tracking_number: "1Z999", carrier: "UPS" }],
      addResult: { error: "duplicate" },
    });
    const logger = vi.fn();
    const result = await scanAndAddPackages(
      envelope({ body_text: "1Z999" }),
      { accountLabel: "Test", logger, trackingClientLoader: () => client },
    );
    expect(result).toEqual([]);
    expect(logger.mock.calls.some((c: string[]) => c[0].includes("failed to add"))).toBe(true);
  });

  it("narvar url extraction", async () => {
    const narvarUrl = "https://track.narvar.com/abc123";
    const client = mockTrackingClient({
      scanText: [],
      urlFound: [],
      narvar: [{ tracking_number: "NAR001", carrier: "USPS" }],
      addResult: { success: true },
    });
    const logger = vi.fn();
    const result = await scanAndAddPackages(
      envelope({ body_text: `Track here: ${narvarUrl}` }),
      { accountLabel: "Test", logger, trackingClientLoader: () => client },
    );
    expect(result).toEqual(["NAR001"]);
    expect(client.fetchNarvarTracking).toHaveBeenCalledWith(narvarUrl);
  });

  it("dedup tracking numbers", async () => {
    const client = mockTrackingClient({
      scanText: [{ tracking_number: "DUP1", carrier: "UPS" }],
      urlFound: [{ tracking_number: "DUP1", carrier: "UPS" }],
      addResult: { success: true },
    });
    const logger = vi.fn();
    const result = await scanAndAddPackages(
      envelope({ body_text: "DUP1" }),
      { accountLabel: "Test", logger, trackingClientLoader: () => client },
    );
    expect(result).toEqual(["DUP1"]);
    expect(client.addPackage).toHaveBeenCalledOnce();
  });

  it("exception returns empty", async () => {
    const client = {
      isShippingSender: vi.fn().mockImplementation(() => { throw new Error("boom"); }),
      scanTextForTrackingNumbers: vi.fn(),
      extractTrackingFromUrls: vi.fn(),
      fetchNarvarTracking: vi.fn(),
      addPackage: vi.fn(),
      removePackage: vi.fn(),
    };
    const logger = vi.fn();
    const result = await scanAndAddPackages(envelope(), {
      accountLabel: "Test",
      logger,
      trackingClientLoader: () => client,
    });
    expect(result).toEqual([]);
    expect(logger.mock.calls.some((c: string[]) => c[0].includes("error"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// scanAndRemoveDelivered
// ---------------------------------------------------------------------------
describe("scanAndRemoveDelivered", () => {
  it("found and removed", async () => {
    const client = mockTrackingClient({
      scanText: [{ tracking_number: "1Z999", carrier: "UPS" }],
      removeResult: { success: true },
    });
    const logger = vi.fn();
    const result = await scanAndRemoveDelivered(
      envelope({ body_text: "Delivered 1Z999" }),
      { logger, trackingClientLoader: () => client },
    );
    expect(result).toEqual(["1Z999"]);
    expect(client.removePackage).toHaveBeenCalledWith("1Z999");
  });

  it("not found ignored", async () => {
    const client = mockTrackingClient({
      scanText: [{ tracking_number: "1Z999", carrier: "UPS" }],
      removeResult: { error: "not_found" },
    });
    const logger = vi.fn();
    const result = await scanAndRemoveDelivered(
      envelope({ body_text: "Delivered 1Z999" }),
      { logger, trackingClientLoader: () => client },
    );
    expect(result).toEqual([]);
    expect(logger.mock.calls.some((c: string[]) => c[0].includes("untracked"))).toBe(true);
  });

  it("no tracking numbers", async () => {
    const client = mockTrackingClient({ scanText: [] });
    const logger = vi.fn();
    const result = await scanAndRemoveDelivered(
      envelope({ body_text: "Delivered but no number" }),
      { logger, trackingClientLoader: () => client },
    );
    expect(result).toEqual([]);
  });

  it("exception returns empty", async () => {
    const client = {
      isShippingSender: vi.fn(),
      scanTextForTrackingNumbers: vi.fn().mockImplementation(() => { throw new Error("boom"); }),
      extractTrackingFromUrls: vi.fn(),
      fetchNarvarTracking: vi.fn(),
      addPackage: vi.fn(),
      removePackage: vi.fn(),
    };
    const logger = vi.fn();
    const result = await scanAndRemoveDelivered(
      envelope({ body_text: "Delivered 1Z999" }),
      { logger, trackingClientLoader: () => client },
    );
    expect(result).toEqual([]);
    expect(logger.mock.calls.some((c: string[]) => c[0].includes("error"))).toBe(true);
  });

  it("remove failure logged", async () => {
    const client = mockTrackingClient({
      scanText: [{ tracking_number: "1Z999", carrier: "UPS" }],
      removeResult: { error: "server_error" },
    });
    const logger = vi.fn();
    const result = await scanAndRemoveDelivered(
      envelope({ body_text: "1Z999" }),
      { logger, trackingClientLoader: () => client },
    );
    expect(result).toEqual([]);
    expect(logger.mock.calls.some((c: string[]) => c[0].includes("failed to remove"))).toBe(true);
  });

  it("uses subject when no body", async () => {
    const client = mockTrackingClient({
      scanText: [{ tracking_number: "1Z999", carrier: "UPS" }],
      removeResult: { success: true },
    });
    const logger = vi.fn();
    const result = await scanAndRemoveDelivered(
      envelope({ subject: "Delivered 1Z999", body_text: undefined }),
      { logger, trackingClientLoader: () => client },
    );
    expect(result).toEqual(["1Z999"]);
  });
});
