/**
 * Tests for JMAP search/read/inbox commands.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeJmapResponse(...methodResponses: [string, Record<string, unknown>, string][]) {
  return {
    ok: true,
    json: () => Promise.resolve({ methodResponses }),
  };
}

describe("cmdInbox()", () => {
  it("returns formatted inbox listing", async () => {
    // First call: Mailbox/get for inbox ID
    mockFetch.mockResolvedValueOnce(
      makeJmapResponse(["Mailbox/get", { list: [{ id: "inbox-id", role: "inbox", name: "Inbox" }] }, "mbox"]),
    );
    // Second call: Email/query + Email/get
    mockFetch.mockResolvedValueOnce(
      makeJmapResponse(
        ["Email/query", { ids: ["e1"], total: 42 }, "q"],
        [
          "Email/get",
          {
            list: [
              {
                id: "e1",
                from: [{ name: "Alice", email: "alice@example.com" }],
                subject: "Hello World",
                receivedAt: "2026-03-15T10:00:00Z",
                keywords: { $seen: true },
              },
            ],
          },
          "g",
        ],
      ),
    );

    const { cmdInbox } = await import("../src/search.js");
    const output = await cmdInbox("tok", "acct1", { limit: 10 });

    expect(output).toContain("📬 Inbox");
    expect(output).toContain("42 total");
    expect(output).toContain("Hello World");
    expect(output).toContain("Alice");
    expect(output).toContain("ID: e1");
  });

  it("supports unread filter", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJmapResponse(["Mailbox/get", { list: [{ id: "inbox-id", role: "inbox", name: "Inbox" }] }, "mbox"]),
    );
    mockFetch.mockResolvedValueOnce(
      makeJmapResponse(
        ["Email/query", { ids: [], total: 0 }, "q"],
        ["Email/get", { list: [] }, "g"],
      ),
    );

    const { cmdInbox } = await import("../src/search.js");
    const output = await cmdInbox("tok", "acct1", { unread: true });
    expect(output).toContain("📬 Inbox");

    // Verify the filter included notKeyword
    const secondCallBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    const filter = secondCallBody.methodCalls[0][1].filter;
    expect(filter.notKeyword).toBe("$seen");
  });
});

describe("cmdSearch()", () => {
  it("searches with keyword filter", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJmapResponse(["Mailbox/get", { list: [{ id: "inbox-id", role: "inbox", name: "Inbox" }] }, "mbox"]),
    );
    mockFetch.mockResolvedValueOnce(
      makeJmapResponse(
        ["Email/query", { ids: ["s1"], total: 1 }, "q"],
        [
          "Email/get",
          {
            list: [
              {
                id: "s1",
                from: [{ email: "noreply@store.com" }],
                subject: "Your order has shipped",
                receivedAt: "2026-03-14T15:30:00Z",
                keywords: {},
              },
            ],
          },
          "g",
        ],
      ),
    );

    const { cmdSearch } = await import("../src/search.js");
    const output = await cmdSearch("tok", "acct1", { query: "order shipped" });

    expect(output).toContain("🔍 Search results");
    expect(output).toContain("Your order has shipped");
  });
});

describe("cmdRead()", () => {
  it("reads and formats a full email", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJmapResponse([
        "Email/get",
        {
          list: [
            {
              id: "r1",
              from: [{ name: "Bob", email: "bob@example.com" }],
              to: [{ name: "Me", email: "me@example.com" }],
              cc: [],
              subject: "Important message",
              receivedAt: "2026-03-15T12:00:00Z",
              textBody: [{ partId: "1" }],
              bodyValues: { "1": { value: "This is the body text." } },
              preview: "This is the preview",
              keywords: { $seen: true },
            },
          ],
        },
        "g",
      ]),
    );

    const { cmdRead } = await import("../src/search.js");
    const output = await cmdRead("tok", "acct1", "r1");

    expect(output).toContain("Subject: Important message");
    expect(output).toContain("From:    Bob <bob@example.com>");
    expect(output).toContain("This is the body text.");
    expect(output).toContain("ID:      r1");
  });

  it("throws on not found", async () => {
    mockFetch.mockResolvedValueOnce(
      makeJmapResponse([
        "Email/get",
        { list: [], notFound: ["missing-id"] },
        "g",
      ]),
    );

    const { cmdRead } = await import("../src/search.js");
    await expect(cmdRead("tok", "acct1", "missing-id")).rejects.toThrow("Email not found");
  });
});
