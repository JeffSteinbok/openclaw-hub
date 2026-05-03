/**
 * Tests for the USPS Mail TS plugin.
 *
 * Mocks @openclaw/mail-action-usps library imports to avoid filesystem
 * and network dependencies. Covers all 6 tools and error cases.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before the module under test is loaded
// ---------------------------------------------------------------------------

vi.mock("@openclaw/mail-action-usps", () => ({
  processDigest: vi.fn(),
}));

vi.mock("../src/usps-rules.js", () => ({
  addRule: vi.fn(),
  removeRule: vi.fn(),
  testRule: vi.fn(),
  listRules: vi.fn(),
}));

vi.mock("../src/usps-memory.js", () => ({
  lookup: vi.fn(),
  getStats: vi.fn(),
  loadState: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Tool registration harness
// ---------------------------------------------------------------------------

interface ToolDef {
  name: string;
  description: string;
  parameters: unknown;
  execute: (id: string, params: Record<string, unknown>) => Promise<unknown>;
}

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  details: Record<string, unknown>;
}

function parseResult(result: unknown): unknown {
  const r = result as ToolResult;
  return JSON.parse(r.content[0].text);
}

function makeApi() {
  const tools: Record<string, ToolDef> = {};
  return {
    pluginConfig: {},
    registerTool(tool: unknown) {
      const t = tool as ToolDef;
      tools[t.name] = t;
    },
    tools,
  };
}

async function loadPlugin() {
  const { createEntry } = await import("../src/index.js");
  const entry = createEntry();
  const api = makeApi();
  entry.register(api);
  return { entry, api };
}

// Import mocked functions for setup
async function getMocks() {
  const mainMod = await import("@openclaw/mail-action-usps");
  const rulesMod = await import("../src/usps-rules.js");
  const memMod = await import("../src/usps-memory.js");
  return {
    processDigest: mainMod.processDigest as ReturnType<typeof vi.fn>,
    addRule: rulesMod.addRule as unknown as ReturnType<typeof vi.fn>,
    removeRule: rulesMod.removeRule as unknown as ReturnType<typeof vi.fn>,
    testRule: rulesMod.testRule as unknown as ReturnType<typeof vi.fn>,
    listRules: rulesMod.listRules as unknown as ReturnType<typeof vi.fn>,
    lookup: memMod.lookup as unknown as ReturnType<typeof vi.fn>,
    getStats: memMod.getStats as unknown as ReturnType<typeof vi.fn>,
    loadState: memMod.loadState as unknown as ReturnType<typeof vi.fn>,
  };
}

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

describe("plugin entry", () => {
  it("has correct id and name", async () => {
    const { entry } = await loadPlugin();
    expect(entry.id).toBe("usps-mail");
    expect(entry.name).toBe("USPS Mail Analyzer");
  });

  it("registers all 6 tools", async () => {
    const { api } = await loadPlugin();
    const names = Object.keys(api.tools).sort();
    expect(names).toEqual([
      "usps_lookup",
      "usps_process_digest",
      "usps_rules",
      "usps_stats",
      "usps_status",
      "usps_update_rule",
    ]);
  });

  it("all tools have name, description, and parameters", async () => {
    const { api } = await loadPlugin();
    for (const tool of Object.values(api.tools)) {
      expect(typeof tool.name).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.parameters).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// usps_process_digest
// ---------------------------------------------------------------------------

describe("usps_process_digest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls processDigest with correct options", async () => {
    const mocks = await getMocks();
    const fakeResult = { date: "2025-01-15", mail_count: 3, images_analyzed: 2 };
    mocks.processDigest.mockResolvedValue(fakeResult);

    const { api } = await loadPlugin();
    const result = parseResult(
      await api.tools["usps_process_digest"].execute("id", {
        folder: "/mail/digest-1",
        workspace_agent: "agent-ws",
        memory_agent: "mem-ws",
        dry_run: true,
        vision_backend: "skip",
      }),
    );

    expect(mocks.processDigest).toHaveBeenCalledWith({
      folder: "/mail/digest-1",
      analysis: undefined,
      date: undefined,
      dryRun: true,
      visionBackend: "skip",
      messageId: undefined,
      workspaceAgent: "agent-ws",
      memoryAgent: "mem-ws",
      visionAgent: undefined,
    });
    expect(result).toEqual(fakeResult);
  });

  it("returns error on exception", async () => {
    const mocks = await getMocks();
    mocks.processDigest.mockRejectedValue(new Error("No body.html"));

    const { api } = await loadPlugin();
    const result = parseResult(
      await api.tools["usps_process_digest"].execute("id", {
        folder: "/bad",
        workspace_agent: "ws",
      }),
    ) as { error: string };

    expect(result.error).toContain("No body.html");
  });
});

// ---------------------------------------------------------------------------
// usps_lookup
// ---------------------------------------------------------------------------

describe("usps_lookup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns formatted lookup results", async () => {
    const mocks = await getMocks();
    mocks.lookup.mockReturnValue([
      {
        date: "2025-01-15",
        filename: "scan-001.jpg",
        info: {
          sender: "Amazon",
          addressee: "John Doe",
          importance: "medium",
          description: "Package notification",
          guid: "abcd1234-ef56-7890",
        },
      },
    ]);

    const { api } = await loadPlugin();
    const result = parseResult(
      await api.tools["usps_lookup"].execute("id", {
        search: "amazon",
        workspace_agent: "ws",
      }),
    ) as { count: number; results: Array<Record<string, unknown>> };

    expect(mocks.lookup).toHaveBeenCalledWith({
      guid: undefined,
      date: undefined,
      search: "amazon",
      workspaceAgent: "ws",
    });
    expect(result.count).toBe(1);
    expect(result.results[0].sender).toBe("Amazon");
    expect(result.results[0].image).toBe("scan-001.jpg");
    expect((result.results[0].guid as string).length).toBe(8);
  });

  it("limits results to 50", async () => {
    const mocks = await getMocks();
    const manyResults = Array.from({ length: 100 }, (_, i) => ({
      date: "2025-01-15",
      filename: `scan-${i}.jpg`,
      info: { sender: `Sender ${i}`, guid: `guid-${i}-xxxxx` },
    }));
    mocks.lookup.mockReturnValue(manyResults);

    const { api } = await loadPlugin();
    const result = parseResult(
      await api.tools["usps_lookup"].execute("id", { workspace_agent: "ws" }),
    ) as { count: number; results: unknown[] };

    expect(result.count).toBe(100);
    expect(result.results.length).toBe(50);
  });

  it("returns error on exception", async () => {
    const mocks = await getMocks();
    mocks.lookup.mockImplementation(() => {
      throw new Error("workspace_agent is required");
    });

    const { api } = await loadPlugin();
    const result = parseResult(
      await api.tools["usps_lookup"].execute("id", { workspace_agent: "" }),
    ) as { error: string };

    expect(result.error).toContain("workspace_agent");
  });
});

// ---------------------------------------------------------------------------
// usps_update_rule — add
// ---------------------------------------------------------------------------

describe("usps_update_rule", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds a rule", async () => {
    const mocks = await getMocks();
    mocks.addRule.mockReturnValue({ action: "added", rule_index: 0, version: "1.0" });

    const { api } = await loadPlugin();
    const result = parseResult(
      await api.tools["usps_update_rule"].execute("id", {
        action: "add",
        conditions: { sender_contains: "amazon" },
        importance: "low",
        comment: "Amazon junk",
        workspace_agent: "ws",
      }),
    ) as Record<string, unknown>;

    expect(mocks.addRule).toHaveBeenCalledWith(
      { sender_contains: "amazon" },
      "low",
      { comment: "Amazon junk", workspaceAgent: "ws" },
    );
    expect(result.action).toBe("added");
  });

  it("removes a rule by index", async () => {
    const mocks = await getMocks();
    mocks.removeRule.mockReturnValue({ action: "removed", rule: { importance: "low" }, version: "1.1" });

    const { api } = await loadPlugin();
    const result = parseResult(
      await api.tools["usps_update_rule"].execute("id", {
        action: "remove",
        index: 2,
        workspace_agent: "ws",
      }),
    ) as Record<string, unknown>;

    expect(mocks.removeRule).toHaveBeenCalledWith({
      index: 2,
      commentMatch: undefined,
      workspaceAgent: "ws",
    });
    expect(result.action).toBe("removed");
  });

  it("removes a rule by comment_match", async () => {
    const mocks = await getMocks();
    mocks.removeRule.mockReturnValue({ action: "removed" });

    const { api } = await loadPlugin();
    await api.tools["usps_update_rule"].execute("id", {
      action: "remove",
      comment_match: "amazon",
      workspace_agent: "ws",
    });

    expect(mocks.removeRule).toHaveBeenCalledWith({
      index: undefined,
      commentMatch: "amazon",
      workspaceAgent: "ws",
    });
  });

  it("tests a rule", async () => {
    const mocks = await getMocks();
    mocks.testRule.mockReturnValue({
      original_importance: "unknown",
      final_importance: "low",
      rule_matched: true,
      rules_version: "1.0",
    });

    const { api } = await loadPlugin();
    const result = parseResult(
      await api.tools["usps_update_rule"].execute("id", {
        action: "test",
        mailpiece: { sender: "Amazon", addressee: "John" },
        workspace_agent: "ws",
      }),
    ) as Record<string, unknown>;

    expect(mocks.testRule).toHaveBeenCalledWith(
      { sender: "Amazon", addressee: "John" },
      "ws",
    );
    expect(result.rule_matched).toBe(true);
  });

  it("returns error for unknown action", async () => {
    const { api } = await loadPlugin();
    const result = parseResult(
      await api.tools["usps_update_rule"].execute("id", {
        action: "invalid",
        workspace_agent: "ws",
      }),
    ) as { error: string };

    expect(result.error).toContain("Unknown action");
  });

  it("returns error on exception", async () => {
    const mocks = await getMocks();
    mocks.addRule.mockImplementation(() => {
      throw new Error("disk full");
    });

    const { api } = await loadPlugin();
    const result = parseResult(
      await api.tools["usps_update_rule"].execute("id", {
        action: "add",
        conditions: {},
        workspace_agent: "ws",
      }),
    ) as { error: string };

    expect(result.error).toContain("disk full");
  });
});

// ---------------------------------------------------------------------------
// usps_rules
// ---------------------------------------------------------------------------

describe("usps_rules", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists all rules", async () => {
    const mocks = await getMocks();
    mocks.listRules.mockReturnValue({
      version: "2.3",
      count: 1,
      rules: [{ index: 0, comment: "test", importance: "low", conditions: {} }],
    });

    const { api } = await loadPlugin();
    const result = parseResult(
      await api.tools["usps_rules"].execute("id", { workspace_agent: "ws" }),
    ) as { version: string; count: number };

    expect(mocks.listRules).toHaveBeenCalledWith("ws");
    expect(result.version).toBe("2.3");
    expect(result.count).toBe(1);
  });

  it("tests a mailpiece when test_mailpiece is provided", async () => {
    const mocks = await getMocks();
    mocks.testRule.mockReturnValue({
      original_importance: "unknown",
      final_importance: "junk",
      rule_matched: true,
      rules_version: "2.3",
    });

    const { api } = await loadPlugin();
    const result = parseResult(
      await api.tools["usps_rules"].execute("id", {
        test_mailpiece: { sender: "Spam Co" },
        workspace_agent: "ws",
      }),
    ) as Record<string, unknown>;

    expect(mocks.testRule).toHaveBeenCalledWith({ sender: "Spam Co" }, "ws");
    expect(result.final_importance).toBe("junk");
  });

  it("returns error on exception", async () => {
    const mocks = await getMocks();
    mocks.listRules.mockImplementation(() => {
      throw new Error("bad read");
    });

    const { api } = await loadPlugin();
    const result = parseResult(
      await api.tools["usps_rules"].execute("id", { workspace_agent: "ws" }),
    ) as { error: string };

    expect(result.error).toContain("bad read");
  });
});

// ---------------------------------------------------------------------------
// usps_stats
// ---------------------------------------------------------------------------

describe("usps_stats", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns stats from getStats", async () => {
    const mocks = await getMocks();
    const fakeStats = {
      total_pieces: 42,
      delivery_days: 10,
      by_importance: { low: 30, medium: 12 },
      top_senders: { "USPS": 20 },
      top_addressees: { "John": 42 },
    };
    mocks.getStats.mockReturnValue(fakeStats);

    const { api } = await loadPlugin();
    const result = parseResult(
      await api.tools["usps_stats"].execute("id", { workspace_agent: "ws" }),
    );

    expect(mocks.getStats).toHaveBeenCalledWith("ws");
    expect(result).toEqual(fakeStats);
  });

  it("returns error on exception", async () => {
    const mocks = await getMocks();
    mocks.getStats.mockImplementation(() => {
      throw new Error("no data");
    });

    const { api } = await loadPlugin();
    const result = parseResult(
      await api.tools["usps_stats"].execute("id", { workspace_agent: "ws" }),
    ) as { error: string };

    expect(result.error).toContain("no data");
  });
});

// ---------------------------------------------------------------------------
// usps_status
// ---------------------------------------------------------------------------

describe("usps_status", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns formatted state", async () => {
    const mocks = await getMocks();
    mocks.loadState.mockReturnValue({
      last_checked_at: "2025-01-15T10:00:00Z",
      last_message_id: "msg-123",
      last_date_processed: "2025-01-15",
      processed_message_ids: ["msg-100", "msg-123"],
    });

    const { api } = await loadPlugin();
    const result = parseResult(
      await api.tools["usps_status"].execute("id", { workspace_agent: "ws" }),
    ) as Record<string, unknown>;

    expect(mocks.loadState).toHaveBeenCalledWith("ws");
    expect(result.last_checked_at).toBe("2025-01-15T10:00:00Z");
    expect(result.last_message_id).toBe("msg-123");
    expect(result.last_date_processed).toBe("2025-01-15");
    expect(result.processed_count).toBe(2);
  });

  it("handles empty state", async () => {
    const mocks = await getMocks();
    mocks.loadState.mockReturnValue({});

    const { api } = await loadPlugin();
    const result = parseResult(
      await api.tools["usps_status"].execute("id", { workspace_agent: "ws" }),
    ) as Record<string, unknown>;

    expect(result.last_checked_at).toBeNull();
    expect(result.last_message_id).toBeNull();
    expect(result.last_date_processed).toBeNull();
    expect(result.processed_count).toBe(0);
  });

  it("returns error on exception", async () => {
    const mocks = await getMocks();
    mocks.loadState.mockImplementation(() => {
      throw new Error("corrupt state");
    });

    const { api } = await loadPlugin();
    const result = parseResult(
      await api.tools["usps_status"].execute("id", { workspace_agent: "ws" }),
    ) as { error: string };

    expect(result.error).toContain("corrupt state");
  });
});
