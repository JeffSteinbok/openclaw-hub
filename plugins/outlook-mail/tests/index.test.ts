import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import https from "node:https";
import { EventEmitter } from "node:events";

afterEach(() => vi.restoreAllMocks());

function mockHttpsSeq(...responses: Array<[string, number]>) {
  const spy = vi.spyOn(https, "request");
  for (const [body, status] of responses) {
    const res = new EventEmitter() as NodeJS.EventEmitter & { statusCode: number };
    res.statusCode = status;
    const req = new EventEmitter() as NodeJS.EventEmitter & { destroy:()=>void; end:()=>void; write:()=>void };
    req.destroy = vi.fn(); req.end = vi.fn(); req.write = vi.fn();
    spy.mockImplementationOnce((_url, _opts, cb) => {
      if (cb) cb(res as Parameters<typeof cb>[0]);
      setTimeout(() => { res.emit("data", Buffer.from(body)); res.emit("end"); }, 0);
      return req as unknown as ReturnType<typeof https.request>;
    });
  }
}

interface ToolDef { name: string; execute: (id: string, params: Record<string,unknown>) => Promise<unknown> }
function makeApi() { const tools: Record<string,ToolDef> = {}; return { pluginConfig:{}, registerTool(t:unknown){tools[(t as ToolDef).name]=t as ToolDef;}, tools }; }
function resultText(r: unknown) { return JSON.parse((r as { content: Array<{text:string}> }).content[0].text); }
async function loadPlugin() { const { createEntry } = await import("../src/index.js"); const entry = createEntry(); const api = makeApi(); entry.register(api); return { entry, api }; }

const TOKEN = JSON.stringify({ access_token: "test-token" });
const MESSAGES = JSON.stringify({ value: [
  { id:"msg1", subject:"Hello", from:{emailAddress:{name:"Alice",address:"alice@test.com"}}, receivedDateTime:"2026-05-02T10:00:00Z", isRead:false, hasAttachments:false, bodyPreview:"Hi" },
  { id:"msg2", subject:"Re: Hello", from:{emailAddress:{name:"Bob",address:"bob@test.com"}}, receivedDateTime:"2026-05-02T09:00:00Z", isRead:true, hasAttachments:false, bodyPreview:"Thanks" },
]});

beforeEach(() => {
  process.env.OUTLOOK_CLIENT_ID = "cid";
  process.env.OUTLOOK_CLIENT_SECRET = "csec";
  process.env.OUTLOOK_REFRESH_TOKEN = "rtoken";
});

describe("plugin entry", () => {
  it("has correct id and name", async () => { const { entry } = await loadPlugin(); expect(entry.id).toBe("outlook-mail"); });
  it("registers all 12 tools", async () => {
    const { api } = await loadPlugin();
    expect(Object.keys(api.tools).sort()).toEqual(["outlook_flag","outlook_forward","outlook_inbox","outlook_meeting","outlook_move","outlook_query_events","outlook_read","outlook_reply","outlook_save_attachments","outlook_search","outlook_send","outlook_update_event"]);
  });
});

describe("outlook_inbox", () => {
  it("returns error when credentials missing", async () => {
    delete process.env.OUTLOOK_CLIENT_ID;
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["outlook_inbox"].execute("id", {}));
    expect(data).toHaveProperty("error");
    process.env.OUTLOOK_CLIENT_ID = "cid";
  });

  it("returns inbox messages", async () => {
    mockHttpsSeq([TOKEN, 200], [MESSAGES, 200], [MESSAGES, 200]);
    const { api } = await loadPlugin();
    const raw = await api.tools["outlook_inbox"].execute("id", { limit: 10 });
    const data = resultText(raw) as Record<string, unknown>;
    // data should have count and messages
    if (data.error) throw new Error(`Tool returned error: ${data.error}`);
    expect(data.count).toBe(2);
    expect((data.messages as Array<Record<string,unknown>>)[0].subject).toBe("Hello");
  });

  it("surfaces HTTP errors", async () => {
    mockHttpsSeq([TOKEN, 200], ["Forbidden", 403]);
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["outlook_inbox"].execute("id", {}));
    expect(data).toHaveProperty("error");
  });
});

describe("outlook_search", () => {
  it("searches and returns messages", async () => {
    mockHttpsSeq([TOKEN, 200], [MESSAGES, 200]);
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["outlook_search"].execute("id", { subject: "Hello" })) as { count: number };
    expect(data.count).toBe(2);
  });
});

describe("outlook_read", () => {
  it("returns error when message_id missing", async () => {
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["outlook_read"].execute("id", {}));
    expect(data).toHaveProperty("error");
  });

  it("reads a message by id", async () => {
    const msg = { id:"msg1", subject:"Hello", from:{emailAddress:{name:"Alice",address:"alice@test.com"}}, receivedDateTime:"2026-05-02T10:00:00Z", isRead:true, hasAttachments:false, bodyPreview:"", body:{content:"Full body",contentType:"text"} };
    mockHttpsSeq([TOKEN, 200], [JSON.stringify(msg), 200]);
    const { api } = await loadPlugin();
    const data = resultText(await api.tools["outlook_read"].execute("id", { message_id: "msg1" })) as Record<string,unknown>;
    expect(data.subject).toBe("Hello");
    expect(data.body).toBe("Full body");
  });
});
