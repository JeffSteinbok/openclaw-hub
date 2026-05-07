/**
 * Tests for plugin entry — tool registration and dispatch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface ToolDef {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (id: string, params: Record<string, unknown>) => Promise<unknown>;
}

function makeApi(config: Record<string, unknown> = {}) {
  const tools: Record<string, ToolDef> = {};
  return {
    pluginConfig: config,
    registerTool(tool: unknown) {
      const t = tool as ToolDef;
      tools[t.name] = t;
    },
    tools,
  };
}

async function loadPlugin(config: Record<string, unknown> = {}) {
  const { createEntry } = await import("../src/index.js");
  const entry = createEntry();
  const api = makeApi(config);
  entry.register(api);
  return { entry, api };
}

describe("plugin entry", () => {
  it("has correct id and name", async () => {
    const { createEntry } = await import("../src/index.js");
    const entry = createEntry();
    expect(entry.id).toBe("fastmail");
    expect(entry.name).toBe("FastMail tools");
  });

  it("registers all 7 tools", async () => {
    const { api } = await loadPlugin();
    const toolNames = Object.keys(api.tools);
    expect(toolNames).toHaveLength(7);
    expect(toolNames).toContain("fastmail_send");
    expect(toolNames).toContain("fastmail_search");
    expect(toolNames).toContain("fastmail_read");
    expect(toolNames).toContain("fastmail_inbox");
    expect(toolNames).toContain("fastmail_meeting");
    expect(toolNames).toContain("fastmail_update_event");
    expect(toolNames).toContain("fastmail_query_events");
  });

  it("each tool has name, description, and execute", async () => {
    const { api } = await loadPlugin();
    for (const tool of Object.values(api.tools)) {
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(10);
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("fastmail_send returns error for misconfigured call", async () => {
    // No fetch mock — should fail with network error or similar
    mockFetch.mockRejectedValueOnce(new Error("Network fail"));

    const { api } = await loadPlugin({
      accountId: "acct",
      jmapToken: "tok",
      fromEmail: "me@example.com",
      fromName: "Me",
      identityId: "id1",
      draftsId: "d1",
      sentId: "s1",
    });

    const result = (await api.tools.fastmail_send.execute("call1", {
      to: "test@example.com",
      subject: "Test",
      body: "Hello",
    })) as { content: Array<{ text: string }> };

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeDefined();
  });

  it("fastmail_meeting returns error when CalDAV not configured", async () => {
    const { api } = await loadPlugin({ accountId: "a", jmapToken: "t" });

    const result = (await api.tools.fastmail_meeting.execute("call2", {
      to: "a@example.com",
      subject: "Meet",
      start: "2026-03-20T10:00",
    })) as { content: Array<{ text: string }> };

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("CalDAV not configured");
  });

  it("fastmail_query_events returns error when CalDAV not configured", async () => {
    const { api } = await loadPlugin({ accountId: "a", jmapToken: "t" });

    const result = (await api.tools.fastmail_query_events.execute("call3", {})) as {
      content: Array<{ text: string }>;
    };

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("CalDAV");
  });
});
