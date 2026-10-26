import { describe, it, expect, vi, afterEach } from "vitest";
import http from "node:http";
import https from "node:https";

afterEach(() => vi.restoreAllMocks());

type Concrete = { name: string; execute: (id: string, params: Record<string, unknown>) => Promise<unknown> };
type Factory = ((ctx?: Record<string, unknown>) => Concrete) & Concrete;

async function loadTool(config: Record<string, unknown>) {
  const { createEntry } = await import("../src/index.js");
  let tool: Factory | undefined;
  let opts: unknown;
  createEntry().register({ pluginConfig: config, registerTool(t: unknown, o?: unknown) { tool = t as Factory; opts = o; } });
  return { tool: tool!, opts };
}
// The full result (content is a compact view for the model).
const text = (r: unknown) => (r as { details: unknown }).details as Record<string, unknown>;

const accessGroups = { bob: { type: "message.senders", members: { imessage: ["+14255550199"] } } };
const CONFIG = {
  calendars: [
    { id: "family", label: "Family", url: "http://example.com/family.ics" },
    { id: "bob", label: "Bob", url: "http://example.com/bob.ics" },
    { id: "tripit", label: "TripIt", url: "http://example.com/tripit.ics" },
  ],
  access: {
    calendars: {
      family: { read: ["*"] },
      bob: { read: [{ agent: "main" }, { sender: "bob" }] },
      _url: { read: [{ agent: "main" }] },
    },
  },
};
const ICS = "BEGIN:VCALENDAR\nEND:VCALENDAR";
function mockIcs() {
  for (const mod of [http, https]) {
    vi.spyOn(mod, "get").mockImplementation(((_url: unknown, _opts: unknown, cb: (res: unknown) => void) => {
      const handlers: Record<string, (arg?: unknown) => void> = {};
      const res = { statusCode: 200, on(ev: string, fn: (arg?: unknown) => void) { handlers[ev] = fn; return res; } };
      cb(res);
      setTimeout(() => { handlers.data?.(Buffer.from(ICS)); handlers.end?.(); }, 0);
      return { on() { return this; }, destroy() {} };
    }) as never);
  }
}

describe("ics_calendar_fetch access control", () => {
  it("registers a factory with its name", async () => {
    const { tool, opts } = await loadTool({});
    expect(typeof tool).toBe("function");
    expect(opts).toEqual({ name: "ics_calendar_fetch" });
  });

  it("allows wildcard calendars for any agent", async () => {
    mockIcs();
    const { tool } = await loadTool(CONFIG);
    const data = text(await tool({ agentId: "group" }).execute("id", { calendar_id: "family" }));
    expect(data.calendar).toBe("Family");
  });

  it("denies a restricted calendar to other agents and senderless turns", async () => {
    const get = vi.spyOn(https, "get");
    const { tool } = await loadTool(CONFIG);
    const data = text(await tool({ agentId: "family" }).execute("id", { calendar_id: "bob" }));
    expect(data).toEqual({ error: 'Access denied: agent "family" (no sender) may not read calendar "bob"' });
    expect(get).not.toHaveBeenCalled();
  });

  it("allows a restricted calendar to its sender group", async () => {
    mockIcs();
    const { tool } = await loadTool(CONFIG);
    const ctx = { agentId: "family", messageChannel: "imessage", requesterSenderId: "+1 425 555 0199", config: { accessGroups } };
    expect(text(await tool(ctx).execute("id", { calendar_id: "bob" })).calendar).toBe("Bob");
  });

  it("default-denies configured calendars missing from the ACL", async () => {
    const { tool } = await loadTool(CONFIG);
    expect(text(await tool({ agentId: "main" }).execute("id", { calendar_id: "tripit" })).error).toContain('calendar "tripit"');
  });

  it("checks ad-hoc urls against the _url pseudo-calendar, even when calendar_id is also given", async () => {
    const { tool } = await loadTool(CONFIG);
    const denied = text(await tool({ agentId: "family" }).execute("id", { url: "http://evil.example/x.ics", calendar_id: "family" }));
    expect(denied.error).toBe('Access denied: agent "family" (no sender) may not read calendar "_url"');
    mockIcs();
    expect(text(await tool({ agentId: "main" }).execute("id", { url: "http://example.com/a.ics", label: "A" })).calendar).toBe("A");
  });

  it("allows everything without an access block", async () => {
    mockIcs();
    const { tool } = await loadTool({ calendars: CONFIG.calendars });
    expect(text(await tool({ agentId: "family" }).execute("id", { calendar_id: "bob" })).calendar).toBe("Bob");
  });
});
