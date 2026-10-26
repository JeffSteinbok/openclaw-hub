import { describe, it, expect, vi, afterEach } from "vitest";
import https from "node:https";

afterEach(() => vi.restoreAllMocks());

type Concrete = { name: string; execute: (id: string, params: Record<string, unknown>) => Promise<unknown> };
type Factory = ((ctx?: Record<string, unknown>) => Concrete) & Concrete;

async function loadTool(config: Record<string, unknown>) {
  const { createEntry } = await import("../src/index.js");
  let tool: Factory | undefined;
  createEntry().register({ pluginConfig: config, registerTool(t: unknown) { tool = t as Factory; } });
  return tool!;
}
// The full result (content is a compact view for the model).
const text = (r: unknown) => (r as { details: unknown }).details as Record<string, unknown>;

const accessGroups = {
  alice: { type: "message.senders", members: { discord: ["111111111111111111"] } },
  bob: { type: "message.senders", members: { imessage: ["+14255550199"] } },
};
const ACCESS = { calendars: { work: { read: [{ agent: "main" }, { sender: "alice" }, { sender: "bob" }] } } };

describe("outlook_work_calendar_fetch access control", () => {
  it("denies other agents on senderless turns without calling EWS", async () => {
    const req = vi.spyOn(https, "request");
    const tool = await loadTool({ calendarUrl: "https://example.com/cal", folderId: "f", access: ACCESS });
    const data = text(await tool({ agentId: "family", config: { accessGroups } }).execute("id", {}));
    expect(data).toEqual({ error: 'Access denied: agent "family" (no sender) may not read calendar "work"' });
    expect(req).not.toHaveBeenCalled();
  });

  it("denies senders outside the granted groups", async () => {
    const tool = await loadTool({ access: ACCESS });
    const ctx = { agentId: "family", messageChannel: "imessage", requesterSenderId: "+14255550123", config: { accessGroups } };
    expect(text(await tool(ctx).execute("id", {})).error).toContain("Access denied");
  });

  it("lets granted agents and senders through to the fetch", async () => {
    const tool = await loadTool({ access: ACCESS });
    // Not configured with a URL, so a permitted call reaches the handler's own config error.
    for (const ctx of [
      { agentId: "main" },
      { agentId: "family", messageChannel: "discord", requesterSenderId: "discord:111111111111111111", config: { accessGroups } },
      { agentId: "family", messageChannel: "imessage", requesterSenderId: "+14255550199", config: { accessGroups } },
    ]) {
      const data = text(await tool(ctx).execute("id", {}));
      expect(String(data.error ?? "")).not.toContain("Access denied");
    }
  });

  it("an ACL without a work entry denies it", async () => {
    const tool = await loadTool({ access: { calendars: {} } });
    expect(text(await tool({ agentId: "main" }).execute("id", {})).error).toContain('calendar "work"');
  });
});
