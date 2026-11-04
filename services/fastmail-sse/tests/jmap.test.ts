import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchNewEmails } from "../src/jmap.js";

function stubJmap(handler: (method: string, args: Record<string, unknown>) => [string, Record<string, unknown>]) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
    const [[method, args]] = JSON.parse(init.body).methodCalls;
    calls.push([method, args]);
    const [name, result] = handler(method, args);
    return new Response(JSON.stringify({ methodResponses: [[name, result, "x"]] }));
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchNewEmails", () => {
  it("follows hasMoreChanges, fetches every created id and returns the server state", async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `e${i}`);
    const calls = stubJmap((method, args) => {
      if (method === "Email/changes") {
        return args["sinceState"] === "s1"
          ? ["Email/changes", { created: ids.slice(0, 30), newState: "s2", hasMoreChanges: true }]
          : ["Email/changes", { created: ids.slice(30), newState: "s3", hasMoreChanges: false }];
      }
      const list = (args["ids"] as string[]).map((id) => ({ id, mailboxIds: { inbox: true } }));
      return ["Email/get", { list }];
    });

    const result = await fetchNewEmails("t", "acct", "s1", ["inbox"]);

    expect(result.newState).toBe("s3");
    expect(result.emails.map((e) => e.id)).toEqual(ids);
    expect(calls.filter(([m]) => m === "Email/get")).toHaveLength(2);
  });

  it("signals a resync when the server cannot calculate changes", async () => {
    stubJmap(() => ["error", { type: "cannotCalculateChanges" }]);
    await expect(fetchNewEmails("t", "acct", "old", ["inbox"])).resolves.toEqual({
      emails: [],
      newState: null,
    });
  });

  it("throws on other JMAP method errors instead of reporting no mail", async () => {
    stubJmap(() => ["error", { type: "serverFail" }]);
    await expect(fetchNewEmails("t", "acct", "s1", ["inbox"])).rejects.toThrow(/serverFail/);
  });
});
