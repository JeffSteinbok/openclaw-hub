/**
 * Tests for the JMAP client module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We mock global fetch
const mockFetch = vi.fn();

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("jmap()", () => {
  it("sends correct request and parses response", async () => {
    const mockResp = {
      methodResponses: [["Email/get", { list: [{ id: "abc" }] }, "g"]],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResp),
    });

    const { jmap } = await import("../src/jmap-client.js");
    const result = await jmap("test-token", [
      ["Email/get", { accountId: "acct1", ids: ["abc"] }, "g"],
    ]);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.fastmail.com/jmap/api/");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer test-token");
    expect(opts.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(opts.body);
    expect(body.using).toContain("urn:ietf:params:jmap:core");
    expect(body.methodCalls).toHaveLength(1);
    expect(body.methodCalls[0][0]).toBe("Email/get");

    expect(result.methodResponses).toHaveLength(1);
    expect(result.methodResponses[0][0]).toBe("Email/get");
  });

  it("throws on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    });

    const { jmap } = await import("../src/jmap-client.js");
    await expect(
      jmap("bad-token", [["Mailbox/get", { accountId: "a" }, "m"]]),
    ).rejects.toThrow("JMAP error 401");
  });

  it("supports custom using capabilities", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ methodResponses: [] }),
    });

    const { jmap } = await import("../src/jmap-client.js");
    await jmap("tok", [["Foo/bar", {}, "x"]], ["urn:custom:cap"]);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.using).toEqual(["urn:custom:cap"]);
  });
});

describe("uploadBlob()", () => {
  it("uploads data and returns blobId", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ blobId: "blob123" }),
    });

    const { uploadBlob } = await import("../src/jmap-client.js");
    const result = await uploadBlob("acct1", "tok", "hello", "text/plain");

    expect(result.blobId).toBe("blob123");
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.fastmail.com/jmap/upload/acct1/");
    expect(opts.headers["Content-Type"]).toBe("text/plain");
  });
});

describe("checkJmapResponse()", () => {
  it("does not throw on success", async () => {
    const { checkJmapResponse } = await import("../src/jmap-client.js");
    expect(() =>
      checkJmapResponse({
        methodResponses: [["Email/set", { created: { e: {} } }, "create"]],
      }),
    ).not.toThrow();
  });

  it("throws on error method response", async () => {
    const { checkJmapResponse } = await import("../src/jmap-client.js");
    expect(() =>
      checkJmapResponse({
        methodResponses: [["error", { type: "serverFail", description: "oops" }, "x"]],
      }),
    ).toThrow("JMAP error");
  });

  it("throws on notCreated", async () => {
    const { checkJmapResponse } = await import("../src/jmap-client.js");
    expect(() =>
      checkJmapResponse({
        methodResponses: [["Email/set", { notCreated: { e: { type: "invalidProperties" } } }, "c"]],
      }),
    ).toThrow("notCreated");
  });
});
