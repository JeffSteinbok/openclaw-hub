/**
 * Tests for FastmailProviderClient.
 */

import { describe, it, expect, vi } from "vitest";
import { FastmailProviderClient } from "../src/provider.js";
import type { MailEnvelope } from "carapace-mail-runtime";

vi.mock("../src/jmap.js", () => ({
  jmap: vi.fn(),
  getJmapSession: vi.fn(),
}));

describe("FastmailProviderClient", () => {
  const logger = vi.fn();

  it("should return envelope unchanged if body already present", async () => {
    const envelope: MailEnvelope = {
      message_id: "m1",
      provider: "fastmail",
      account_id: "acct1",
      mailbox_id: "inbox",
      sender_name: "Test",
      sender_email: "test@example.com",
      subject: "Test",
      body_text: "existing text",
      body_html: "<p>existing</p>",
      raw: {},
    };

    const client = new FastmailProviderClient("token123", logger);
    const result = await client.fetchBody(envelope);
    expect(result.body_text).toBe("existing text");
    expect(result.body_html).toBe("<p>existing</p>");
  });

  it("should fetch body via JMAP when not present", async () => {
    const { jmap } = await import("../src/jmap.js");
    const mockJmap = jmap as ReturnType<typeof vi.fn>;
    mockJmap.mockResolvedValue({
      methodResponses: [
        [
          "Email/get",
          {
            list: [
              {
                id: "m1",
                textBody: [{ partId: "1" }],
                htmlBody: [{ partId: "2" }],
                bodyValues: {
                  "1": { value: "fetched text" },
                  "2": { value: "<p>fetched</p>" },
                },
                blobId: "blob1",
              },
            ],
          },
          "get",
        ],
      ],
    });

    const envelope: MailEnvelope = {
      message_id: "m1",
      provider: "fastmail",
      account_id: "acct1",
      mailbox_id: "inbox",
      sender_name: "Test",
      sender_email: "test@example.com",
      subject: "Test",
      body_text: null,
      body_html: null,
      raw: {},
    };

    const client = new FastmailProviderClient("token123", logger);
    const result = await client.fetchBody(envelope);
    expect(result.body_text).toBe("fetched text");
    expect(result.body_html).toBe("<p>fetched</p>");
  });

  it("should throw when message not found during body fetch", async () => {
    const { jmap } = await import("../src/jmap.js");
    const mockJmap = jmap as ReturnType<typeof vi.fn>;
    mockJmap.mockResolvedValue({
      methodResponses: [["Email/get", { list: [] }, "get"]],
    });

    const envelope: MailEnvelope = {
      message_id: "m-not-found",
      provider: "fastmail",
      account_id: "acct1",
      mailbox_id: "inbox",
      sender_name: "Test",
      sender_email: "test@example.com",
      subject: "Test",
      body_text: null,
      body_html: null,
      raw: {},
    };

    const client = new FastmailProviderClient("token123", logger);
    await expect(client.fetchBody(envelope)).rejects.toThrow(
      "Fastmail message not found: m-not-found",
    );
  });
});
