/**
 * Tests for scanAndAddPackages / tracking integration.
 */

import { describe, it, expect, vi } from "vitest";
import {
  scanAndAddPackages,
  type TrackingClient,
  type MailEnvelope,
} from "carapace-mail-runtime";

function makeEnvelope(overrides: Partial<MailEnvelope> = {}): MailEnvelope {
  return {
    message_id: "m1",
    provider: "fastmail",
    account_id: "test_acct",
    mailbox_id: "inbox",
    sender_name: "",
    sender_email: "test@example.com",
    subject: "Test",
    body_text: "",
    body_html: "",
    ...overrides,
  };
}

function makeMockTrackingClient(
  overrides: Partial<TrackingClient> = {},
): TrackingClient {
  return {
    isShippingSender: vi.fn().mockReturnValue(true),
    scanTextForTrackingNumbers: vi.fn().mockReturnValue([]),
    extractTrackingFromUrls: vi.fn().mockReturnValue([]),
    fetchNarvarTracking: vi.fn().mockReturnValue([]),
    addPackage: vi.fn().mockReturnValue({}),
    removePackage: vi.fn().mockReturnValue({}),
    ...overrides,
  };
}

describe("TestScanAndAddPackages", () => {
  const logger = vi.fn();

  it("should return empty list when email has no body", async () => {
    const envelope = makeEnvelope({ body_text: "" });
    const mock = makeMockTrackingClient();

    const result = await scanAndAddPackages(envelope, {
      accountLabel: "Test",
      logger,
      trackingClientLoader: () => mock,
    });
    expect(result).toHaveLength(0);
  });

  it("should find and add UPS tracking numbers", async () => {
    const envelope = makeEnvelope({
      subject: "Package Shipped",
      sender_name: "UPS",
      sender_email: "pkginfo@ups.com",
      body_text: "Your package 1Z999AA10123456784 is on the way!",
      body_html: "",
    });

    const mock = makeMockTrackingClient({
      scanTextForTrackingNumbers: vi.fn().mockReturnValue([
        {
          tracking_number: "1Z999AA10123456784",
          carrier: "UPS",
          url: "https://www.ups.com/track?tracknum=1Z999AA10123456784",
        },
      ]),
      addPackage: vi.fn().mockReturnValue({
        tracking_number: "1Z999AA10123456784",
        carrier: "UPS",
        url: "https://www.ups.com/track?tracknum=1Z999AA10123456784",
      }),
    });

    const result = await scanAndAddPackages(envelope, {
      accountLabel: "Test Account",
      logger,
      trackingClientLoader: () => mock,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ tracking_number: "1Z999AA10123456784", carrier: "UPS", url: "https://www.ups.com/track?tracknum=1Z999AA10123456784" });
  });

  it("should return empty list when no tracking numbers found", async () => {
    const envelope = makeEnvelope({
      subject: "Regular Email",
      body_text: "This is a regular email with no tracking numbers.",
    });

    const mock = makeMockTrackingClient();

    const result = await scanAndAddPackages(envelope, {
      accountLabel: "Test",
      logger,
      trackingClientLoader: () => mock,
    });
    expect(result).toHaveLength(0);
  });

  it("should handle errors when adding packages", async () => {
    const envelope = makeEnvelope({
      subject: "Package",
      body_text: "Tracking: 1Z999AA10123456784",
    });

    const mock = makeMockTrackingClient({
      scanTextForTrackingNumbers: vi.fn().mockReturnValue([
        { tracking_number: "1Z999AA10123456784", carrier: "UPS" },
      ]),
      addPackage: vi.fn().mockReturnValue({ error: "Failed to add package" }),
    });

    const result = await scanAndAddPackages(envelope, {
      accountLabel: "Shopping",
      logger,
      trackingClientLoader: () => mock,
    });
    expect(result).toHaveLength(0);
  });

  it("should handle exceptions gracefully", async () => {
    const envelope = makeEnvelope({ body_text: "Body text" });

    const result = await scanAndAddPackages(envelope, {
      accountLabel: "Test",
      logger,
      trackingClientLoader: () => {
        throw new Error("Test error");
      },
    });
    expect(result).toHaveLength(0);
  });

  it("should skip non-shipping sender", async () => {
    const envelope = makeEnvelope({
      subject: "Newsletter",
      sender_email: "news@random-store.com",
      body_text: "Some text",
    });

    const mock = makeMockTrackingClient({
      isShippingSender: vi.fn().mockReturnValue(false),
    });

    const result = await scanAndAddPackages(envelope, {
      accountLabel: "Test",
      logger,
      trackingClientLoader: () => mock,
    });

    expect(result).toHaveLength(0);
    expect(mock.scanTextForTrackingNumbers).not.toHaveBeenCalled();
  });

  it("should proceed to scan shipping sender", async () => {
    const envelope = makeEnvelope({
      subject: "Your package has shipped",
      sender_name: "UPS",
      sender_email: "pkginfo@ups.com",
      body_text: "Your UPS tracking number is 1Z999AA10123456784",
      body_html: "",
    });

    const mock = makeMockTrackingClient({
      scanTextForTrackingNumbers: vi.fn().mockReturnValue([
        {
          tracking_number: "1Z999AA10123456784",
          carrier: "UPS",
          url: "https://www.ups.com/track?tracknum=1Z999AA10123456784",
        },
      ]),
      addPackage: vi.fn().mockReturnValue({
        tracking_number: "1Z999AA10123456784",
        carrier: "UPS",
        url: "https://www.ups.com/track?tracknum=1Z999AA10123456784",
      }),
    });

    const result = await scanAndAddPackages(envelope, {
      accountLabel: "Personal",
      logger,
      trackingClientLoader: () => mock,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ tracking_number: "1Z999AA10123456784", carrier: "UPS", url: "https://www.ups.com/track?tracknum=1Z999AA10123456784" });
    expect(mock.scanTextForTrackingNumbers).toHaveBeenCalledOnce();
  });

  it("should skip Amazon senders", async () => {
    const envelope = makeEnvelope({
      subject: "Your Amazon order",
      sender_email: "ship@amazon.com",
      body_text: "Tracking 1Z999AA10123456784",
    });

    const mock = makeMockTrackingClient();

    const result = await scanAndAddPackages(envelope, {
      accountLabel: "Personal",
      logger,
      trackingClientLoader: () => mock,
    });

    expect(result).toEqual([]);
    expect(mock.scanTextForTrackingNumbers).not.toHaveBeenCalled();
  });
});
