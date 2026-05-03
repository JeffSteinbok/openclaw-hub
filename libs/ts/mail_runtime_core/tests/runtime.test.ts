import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import {
  ActionRegistry,
  normalizeAction,
  ruleMatches,
  selectMatchingRules,
  executeRules,
  type MailEnvelope,
  type ActionResult,
  type MailProviderClient,
} from "../src/runtime.js";

function envelope(overrides: Partial<MailEnvelope> = {}): MailEnvelope {
  return {
    message_id: "msg-1",
    provider: "test-provider",
    account_id: "acct-1",
    mailbox_id: "inbox",
    sender_name: "Alice Smith",
    sender_email: "alice@example.com",
    subject: "Hello World",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeAction
// ---------------------------------------------------------------------------
describe("normalizeAction", () => {
  it("string action", () => {
    const [name, params] = normalizeAction("do_thing");
    expect(name).toBe("do_thing");
    expect(params).toEqual({});
  });

  it("dict action with params", () => {
    const [name, params] = normalizeAction({ name: "do_thing", params: { k: "v" } });
    expect(name).toBe("do_thing");
    expect(params).toEqual({ k: "v" });
  });

  it("dict action without params", () => {
    const [name, params] = normalizeAction({ name: "do_thing" });
    expect(name).toBe("do_thing");
    expect(params).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// ActionRegistry
// ---------------------------------------------------------------------------
describe("ActionRegistry", () => {
  it("register and get", () => {
    const reg = new ActionRegistry();
    const handler = vi.fn();
    reg.register("my_action", handler, { needs_body: true });
    const action = reg.get("my_action");
    expect(action.name).toBe("my_action");
    expect(action.needs_body).toBe(true);
    expect(action.handler).toBe(handler);
  });

  it("get unknown raises", () => {
    const reg = new ActionRegistry();
    expect(() => reg.get("missing")).toThrow("Unknown mail action");
  });

  it("register with attachment request", () => {
    const reg = new ActionRegistry();
    const handler = vi.fn();
    const req = { content_types: ["image/png"] };
    reg.register("img_action", handler, { attachment_request: req });
    const action = reg.get("img_action");
    expect(action.attachment_request).toEqual(req);
    expect(action.needs_body).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ruleMatches
// ---------------------------------------------------------------------------
describe("ruleMatches", () => {
  it("empty match returns true", () => {
    expect(ruleMatches(envelope(), { match: {} })).toBe(true);
  });

  it("no match key returns true", () => {
    expect(ruleMatches(envelope(), {})).toBe(true);
  });

  it("sender_email exact", () => {
    const rule = { match: { sender_email: "alice@example.com" } };
    expect(ruleMatches(envelope(), rule)).toBe(true);
    expect(ruleMatches(envelope({ sender_email: "bob@example.com" }), rule)).toBe(false);
  });

  it("sender_email case insensitive", () => {
    const rule = { match: { sender_email: "Alice@Example.COM" } };
    expect(ruleMatches(envelope({ sender_email: "alice@example.com" }), rule)).toBe(true);
  });

  it("sender_domain", () => {
    const rule = { match: { sender_domain: "example.com" } };
    expect(ruleMatches(envelope({ sender_email: "alice@example.com" }), rule)).toBe(true);
    expect(ruleMatches(envelope({ sender_email: "alice@other.com" }), rule)).toBe(false);
  });

  it("sender_domain subdomain", () => {
    const rule = { match: { sender_domain: "example.com" } };
    expect(ruleMatches(envelope({ sender_email: "alice@mail.example.com" }), rule)).toBe(true);
  });

  it("sender_name_contains", () => {
    const rule = { match: { sender_name_contains: "alice" } };
    expect(ruleMatches(envelope({ sender_name: "Alice Smith" }), rule)).toBe(true);
    expect(ruleMatches(envelope({ sender_name: "Bob Jones" }), rule)).toBe(false);
  });

  it("subject exact", () => {
    const rule = { match: { subject: "Hello World" } };
    expect(ruleMatches(envelope(), rule)).toBe(true);
    expect(ruleMatches(envelope({ subject: "Hello" }), rule)).toBe(false);
  });

  it("subject_contains", () => {
    const rule = { match: { subject_contains: "hello" } };
    expect(ruleMatches(envelope({ subject: "Say Hello Friend" }), rule)).toBe(true);
    expect(ruleMatches(envelope({ subject: "Goodbye" }), rule)).toBe(false);
  });

  it("subject_prefix", () => {
    const rule = { match: { subject_prefix: "hello" } };
    expect(ruleMatches(envelope({ subject: "Hello World" }), rule)).toBe(true);
    expect(ruleMatches(envelope({ subject: "World Hello" }), rule)).toBe(false);
  });

  it("subject_regex", () => {
    const rule = { match: { subject_regex: "order\\s*#\\d+" } };
    expect(ruleMatches(envelope({ subject: "Order #123 shipped" }), rule)).toBe(true);
    expect(ruleMatches(envelope({ subject: "No order here" }), rule)).toBe(false);
  });

  it("body_contains", () => {
    const rule = { match: { body_contains: "special" } };
    expect(ruleMatches(envelope({ body_text: "Something special here" }), rule)).toBe(true);
    expect(ruleMatches(envelope({ body_text: "Nothing here" }), rule)).toBe(false);
  });

  it("body_contains html", () => {
    const rule = { match: { body_contains: "special" } };
    expect(ruleMatches(envelope({ body_html: "<b>special</b>" }), rule)).toBe(true);
  });

  it("has_attachments true", () => {
    const rule = { match: { has_attachments: true } };
    expect(ruleMatches(envelope({ has_attachments: true }), rule)).toBe(true);
    expect(ruleMatches(envelope({ has_attachments: false }), rule)).toBe(false);
  });

  it("has_attachments false", () => {
    const rule = { match: { has_attachments: false } };
    expect(ruleMatches(envelope({ has_attachments: false }), rule)).toBe(true);
    expect(ruleMatches(envelope({ has_attachments: true }), rule)).toBe(false);
  });

  it("providers filter", () => {
    const rule = { providers: "test-provider" };
    expect(ruleMatches(envelope({ provider: "test-provider" }), rule)).toBe(true);
    expect(ruleMatches(envelope({ provider: "other" }), rule)).toBe(false);
  });

  it("accounts filter", () => {
    const rule = { accounts: "acct-1" };
    expect(ruleMatches(envelope({ account_id: "acct-1" }), rule)).toBe(true);
    expect(ruleMatches(envelope({ account_id: "acct-2" }), rule)).toBe(false);
  });

  it("mailboxes filter", () => {
    const rule = { mailboxes: "inbox" };
    expect(ruleMatches(envelope({ mailbox_id: "inbox" }), rule)).toBe(true);
    expect(ruleMatches(envelope({ mailbox_id: "spam" }), rule)).toBe(false);
  });

  it("list values", () => {
    const rule = { match: { sender_email: ["alice@example.com", "bob@example.com"] } };
    expect(ruleMatches(envelope({ sender_email: "bob@example.com" }), rule)).toBe(true);
  });

  it("unsupported condition", () => {
    const rule = { match: { nonexistent_key: "val" } };
    expect(() => ruleMatches(envelope(), rule)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// selectMatchingRules
// ---------------------------------------------------------------------------
describe("selectMatchingRules", () => {
  it("skips disabled", () => {
    const rules = [
      { id: "r1", enabled: false, match: {} },
      { id: "r2", match: {} },
    ];
    const result = selectMatchingRules(envelope(), rules);
    expect(result).toHaveLength(1);
    expect(result[0]["id"]).toBe("r2");
  });

  it("stops at first non-continue", () => {
    const rules = [
      { id: "r1", match: {}, continue: true },
      { id: "r2", match: {} },
      { id: "r3", match: {} },
    ];
    const result = selectMatchingRules(envelope(), rules);
    expect(result.map((r) => r["id"])).toEqual(["r1", "r2"]);
  });

  it("all continue", () => {
    const rules = [
      { id: "r1", match: {}, continue: true },
      { id: "r2", match: {}, continue: true },
    ];
    const result = selectMatchingRules(envelope(), rules);
    expect(result).toHaveLength(2);
  });

  it("no match", () => {
    const rules = [{ id: "r1", match: { sender_email: "nobody@nowhere.com" } }];
    const result = selectMatchingRules(envelope(), rules);
    expect(result).toEqual([]);
  });

  it("enabled default true", () => {
    const rules = [{ id: "r1", match: {} }];
    const result = selectMatchingRules(envelope(), rules);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// executeRules
// ---------------------------------------------------------------------------
describe("executeRules", () => {
  const workspace = "_test_workspace_execute_rules_ts";

  beforeEach(() => {
    mkdirSync(workspace, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(workspace)) {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("happy path", async () => {
    const handler = vi.fn().mockReturnValue([{ kind: "log", payload: { message: "ok" } }]);
    const registry = new ActionRegistry();
    registry.register("my_action", handler);

    const rules = [{ id: "r1", match: {}, actions: ["my_action"] }];
    const provider = {
      fetchBody: vi.fn(),
      listAttachments: vi.fn(),
      downloadAttachments: vi.fn(),
    } as unknown as MailProviderClient;
    const logger = vi.fn();

    const [matched, results] = await executeRules(envelope(), rules, registry, provider, {
      workspace,
      logger,
    });
    expect(matched).toHaveLength(1);
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe("log");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("needs_body", async () => {
    const handler = vi.fn().mockReturnValue([]);
    const registry = new ActionRegistry();
    registry.register("body_action", handler, { needs_body: true });

    const rules = [{ id: "r1", match: {}, actions: ["body_action"] }];
    const provider = {
      fetchBody: vi.fn().mockReturnValue(envelope({ body_text: "fetched body" })),
      listAttachments: vi.fn(),
      downloadAttachments: vi.fn(),
    } as unknown as MailProviderClient;
    const logger = vi.fn();

    await executeRules(envelope(), rules, registry, provider, { workspace, logger });
    expect(provider.fetchBody).toHaveBeenCalledOnce();
  });

  it("attachment_request downloads and cleans", async () => {
    const handler = vi.fn().mockReturnValue([]);
    const req = { content_types: ["image/png"] };
    const registry = new ActionRegistry();
    registry.register("img_action", handler, { attachment_request: req });

    const rules = [{ id: "r1", match: {}, actions: ["img_action"] }];
    const provider = {
      fetchBody: vi.fn(),
      listAttachments: vi.fn(),
      downloadAttachments: vi.fn().mockReturnValue(["file1.png"]),
    } as unknown as MailProviderClient;
    const logger = vi.fn();

    await executeRules(envelope(), rules, registry, provider, { workspace, logger });
    expect(provider.downloadAttachments).toHaveBeenCalledOnce();
    const ctxArg = handler.mock.calls[0][0];
    expect(ctxArg.artifacts["download_dir"]).toBeDefined();
    expect(ctxArg.artifacts["downloaded_files"]).toEqual(["file1.png"]);
  });

  it("keep_downloads skips cleanup", async () => {
    const handler = vi.fn().mockReturnValue([]);
    const req = { content_types: ["image/png"] };
    const registry = new ActionRegistry();
    registry.register("img_action", handler, { attachment_request: req });

    const rules = [
      {
        id: "r1",
        match: {},
        actions: [{ name: "img_action", params: { keep_downloads: true } }],
      },
    ];
    const provider = {
      fetchBody: vi.fn(),
      listAttachments: vi.fn(),
      downloadAttachments: vi.fn().mockReturnValue(["file1.png"]),
    } as unknown as MailProviderClient;
    const logger = vi.fn();

    await executeRules(envelope(), rules, registry, provider, { workspace, logger });
    const ctxArg = handler.mock.calls[0][0];
    const downloadDir = ctxArg.artifacts["download_dir"] as string;
    expect(existsSync(downloadDir)).toBe(true);
    rmSync(downloadDir, { recursive: true, force: true });
  });

  it("no matching rules", async () => {
    const registry = new ActionRegistry();
    const rules = [{ id: "r1", match: { sender_email: "nobody@nowhere.com" } }];
    const provider = {
      fetchBody: vi.fn(),
      listAttachments: vi.fn(),
      downloadAttachments: vi.fn(),
    } as unknown as MailProviderClient;
    const logger = vi.fn();

    const [matched, results] = await executeRules(envelope(), rules, registry, provider, {
      workspace,
      logger,
    });
    expect(matched).toEqual([]);
    expect(results).toEqual([]);
  });

  it("config passed to context", async () => {
    const handler = vi.fn().mockReturnValue([]);
    const registry = new ActionRegistry();
    registry.register("cfg_action", handler);

    const rules = [{ id: "r1", match: {}, actions: ["cfg_action"] }];
    const provider = {
      fetchBody: vi.fn(),
      listAttachments: vi.fn(),
      downloadAttachments: vi.fn(),
    } as unknown as MailProviderClient;
    const logger = vi.fn();
    const config = { key: "value" };

    await executeRules(envelope(), rules, registry, provider, {
      workspace,
      logger,
      config,
    });
    const ctxArg = handler.mock.calls[0][0];
    expect(ctxArg.config).toEqual({ key: "value" });
  });
});
