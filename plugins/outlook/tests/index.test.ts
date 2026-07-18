import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import https from "node:https";
import { EventEmitter } from "node:events";

afterEach(() => vi.restoreAllMocks());

function mockHttpsSeq(...responses: Array<[string, number]>) {
  const spy = vi.spyOn(https, "request");
  for (const [body, status] of responses) {
    const res = new EventEmitter() as NodeJS.EventEmitter & { statusCode: number; resume: () => void };
    res.statusCode = status;
    res.resume = () => {};
    const req = new EventEmitter() as NodeJS.EventEmitter & { destroy: () => void; end: () => void; write: () => void };
    req.destroy = vi.fn(); req.end = vi.fn(); req.write = vi.fn();
    spy.mockImplementationOnce((_url, _opts, cb) => {
      if (cb) cb(res as Parameters<typeof cb>[0]);
      setTimeout(() => { res.emit("data", Buffer.from(body)); res.emit("end"); }, 0);
      return req as unknown as ReturnType<typeof https.request>;
    });
  }
}

interface ToolDef { name: string; parameters: { properties: Record<string, unknown> }; execute: (id: string, params: Record<string, unknown>) => Promise<unknown> }
function makeApi() {
  const tools: Record<string, ToolDef> = {};
  return { pluginConfig: {}, registerTool(t: unknown) { tools[(t as ToolDef).name] = t as ToolDef; }, tools };
}
function resultText(r: unknown) { return JSON.parse((r as { content: Array<{ text: string }> }).content[0].text); }

// Re-import fresh module each time to avoid mock state bleed between tests.
async function loadPlugin() {
  const { createEntry } = await import("../src/index.js");
  const entry = createEntry();
  const api = makeApi();
  entry.register(api);
  return { entry, api };
}

const TOKEN = JSON.stringify({ access_token: "test-token" });
const MESSAGES = JSON.stringify({
  value: [
    { id: "msg1", subject: "Hello", from: { emailAddress: { name: "Alice", address: "alice@test.com" } }, receivedDateTime: "2026-05-02T10:00:00Z", isRead: false, hasAttachments: false, bodyPreview: "Hi" },
    { id: "msg2", subject: "Re: Hello", from: { emailAddress: { name: "Bob", address: "bob@test.com" } }, receivedDateTime: "2026-05-02T09:00:00Z", isRead: true, hasAttachments: false, bodyPreview: "Thanks" },
  ],
});
const CALENDARS = JSON.stringify({ value: [{ name: "Calendar", id: "cal-1" }, { name: "Your Family", id: "fam-1" }] });
const EVENTS = JSON.stringify({
  value: [{
    id: "evt1", subject: "Team Standup",
    start: { dateTime: "2026-05-03T17:00:00Z", timeZone: "UTC" },
    end: { dateTime: "2026-05-03T17:30:00Z", timeZone: "UTC" },
    location: { displayName: "Zoom" },
    organizer: { emailAddress: { name: "Jeff", address: "jeff@test.com" } },
    attendees: [], responseStatus: { response: "accepted" }, showAs: "busy",
    body: { contentType: "html", content: "<div>Agenda item</div>" },
  }],
});

beforeEach(() => {
  process.env.OUTLOOK_CLIENT_ID = "cid";
  process.env.OUTLOOK_CLIENT_SECRET = "csec";
  process.env.OUTLOOK_REFRESH_TOKEN = "rtoken";
});

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

describe("plugin entry", () => {
  it("has correct id and name", async () => {
    const { entry } = await loadPlugin();
    expect(entry.id).toBe("outlook");
    expect(entry.name).toBe("Outlook");
  });

  it("registers all 15 tools", async () => {
    const { api } = await loadPlugin();
    expect(Object.keys(api.tools).sort()).toEqual([
      "outlook_calendar_fetch",
      "outlook_create_event",
      "outlook_delete_event",
      "outlook_flag",
      "outlook_forward",
      "outlook_inbox",
      "outlook_meeting",
      "outlook_move",
      "outlook_query_events",
      "outlook_read",
      "outlook_reply",
      "outlook_save_attachments",
      "outlook_search",
      "outlook_send",
      "outlook_update_event",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Mail: outlook_inbox
// ---------------------------------------------------------------------------

describe("outlook_inbox", () => {
  it("returns error when credentials missing", async () => {
    delete process.env.OUTLOOK_CLIENT_ID;
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["outlook_inbox"].execute("id", {}));
    expect(data).toHaveProperty("error");
    process.env.OUTLOOK_CLIENT_ID = "cid";
  });

  it("returns inbox messages", async () => {
    mockHttpsSeq([TOKEN, 200], [MESSAGES, 200]);
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["outlook_inbox"].execute("id", { limit: 10 })) as Record<string, unknown>;
    expect(data.count).toBe(2);
    expect((data.messages as Array<Record<string, unknown>>)[0].subject).toBe("Hello");
  });

  it("surfaces HTTP errors", async () => {
    mockHttpsSeq([TOKEN, 200], ["Forbidden", 403]);
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["outlook_inbox"].execute("id", {}));
    expect(data).toHaveProperty("error");
  });
});

// ---------------------------------------------------------------------------
// Mail: outlook_search
// ---------------------------------------------------------------------------

describe("outlook_search", () => {
  it("returns search results", async () => {
    mockHttpsSeq([TOKEN, 200], [MESSAGES, 200]);
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["outlook_search"].execute("id", { subject: "Hello" })) as { count: number };
    expect(data.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Mail: outlook_read
// ---------------------------------------------------------------------------

describe("outlook_read", () => {
  it("returns error when message_id missing", async () => {
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["outlook_read"].execute("id", {}));
    expect(data).toHaveProperty("error");
  });

  it("reads a message by id", async () => {
    const msg = {
      id: "msg1", subject: "Hello",
      from: { emailAddress: { name: "Alice", address: "alice@test.com" } },
      receivedDateTime: "2026-05-02T10:00:00Z", isRead: true, hasAttachments: false,
      bodyPreview: "", body: { content: "Full body text", contentType: "text" },
    };
    mockHttpsSeq([TOKEN, 200], [JSON.stringify(msg), 200]);
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["outlook_read"].execute("id", { message_id: "msg1" })) as Record<string, unknown>;
    expect(data.subject).toBe("Hello");
    expect(data.body).toBe("Full body text");
  });
});

// ---------------------------------------------------------------------------
// Mail: outlook_send
// ---------------------------------------------------------------------------

describe("outlook_send", () => {
  it("returns error when to missing", async () => {
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["outlook_send"].execute("id", { subject: "Hi", body: "Test" }));
    expect(data).toHaveProperty("error");
  });

  it("sends a message and returns success", async () => {
    mockHttpsSeq([TOKEN, 200], [JSON.stringify({ id: "draft-1" }), 201], ["", 202]);
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["outlook_send"].execute("id", {
      to: "octo@steinbok.net",
      subject: "Test",
      body: "Hello",
    })) as Record<string, unknown>;
    expect(data.ok).toBe(true);
    expect(data.message).toContain("octo@steinbok.net");
  });
});

// ---------------------------------------------------------------------------
// Mail: outlook_reply
// ---------------------------------------------------------------------------

describe("outlook_reply", () => {
  it("returns error when message_id missing", async () => {
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["outlook_reply"].execute("id", { body: "Thanks" }));
    expect(data).toHaveProperty("error");
  });

  it("replies to a message", async () => {
    mockHttpsSeq([TOKEN, 200], ["", 202]);
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["outlook_reply"].execute("id", {
      message_id: "msg1",
      body: "Thanks!",
    })) as Record<string, unknown>;
    expect(data.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Calendar: outlook_calendar_fetch
// ---------------------------------------------------------------------------

describe("outlook_calendar_fetch", () => {
  it("returns error when credentials missing", async () => {
    delete process.env.OUTLOOK_CLIENT_ID;
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["outlook_calendar_fetch"].execute("id", {}));
    expect(data).toHaveProperty("error");
    process.env.OUTLOOK_CLIENT_ID = "cid";
  });

  it("returns calendar events", async () => {
    mockHttpsSeq([TOKEN, 200], [CALENDARS, 200], [EVENTS, 200], [EVENTS, 200]);
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["outlook_calendar_fetch"].execute("id", { calendar: "all", days: 7 })) as Record<string, { events: unknown[] }>;
    // Returns { personal: { events: [...] }, family: { events: [...] } }
    expect(data.personal).toBeDefined();
    expect(Array.isArray(data.personal.events)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Calendar: outlook_create_event
// ---------------------------------------------------------------------------

describe("outlook_create_event", () => {
  it("returns error when subject missing", async () => {
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["outlook_create_event"].execute("id", { start: "2026-08-01T10:00" }));
    expect(data).toHaveProperty("error");
  });

  it("creates an event", async () => {
    const created = { id: "evt-new", subject: "New Event", start: { dateTime: "2026-08-01T17:00:00Z", timeZone: "UTC" }, end: { dateTime: "2026-08-01T18:00:00Z", timeZone: "UTC" }, webLink: "" };
    mockHttpsSeq([TOKEN, 200], [CALENDARS, 200], [JSON.stringify(created), 201]);
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["outlook_create_event"].execute("id", {
      subject: "New Event",
      start: "2026-08-01T10:00",
    })) as Record<string, unknown>;
    expect(data.event_id).toBe("evt-new");
    expect(data.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Calendar: outlook_query_events
// ---------------------------------------------------------------------------

describe("outlook_query_events", () => {
  it("returns events matching text filter", async () => {
    mockHttpsSeq([TOKEN, 200], [CALENDARS, 200], [EVENTS, 200], [EVENTS, 200]);
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["outlook_query_events"].execute("id", { text: "Standup" })) as { count: number };
    expect(data.count).toBeGreaterThan(0);
  });
});
