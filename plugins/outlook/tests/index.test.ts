import { describe, it, expect } from "vitest";

interface ToolDef { name: string; parameters: { properties: Record<string, unknown> }; execute: (...args: unknown[]) => Promise<unknown> }
function makeApi() {
  const tools: Record<string, ToolDef> = {};
  return { pluginConfig: {}, registerTool(t: unknown) { tools[(t as ToolDef).name] = t as ToolDef; }, tools };
}

async function loadPlugin() {
  const { createEntry } = await import("../src/index.js");
  const entry = createEntry();
  const api = makeApi();
  entry.register(api);
  return { entry, api };
}

describe("outlook plugin", () => {
  it("has correct plugin id", async () => {
    const { entry } = await loadPlugin();
    expect(entry.id).toBe("outlook");
  });

  it("registers all 15 tools", async () => {
    const { api } = await loadPlugin();
    const names = Object.keys(api.tools).sort();
    expect(names).toEqual([
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

  it("outlook_inbox has correct parameters", async () => {
    const { api } = await loadPlugin();
    const tool = api.tools["outlook_inbox"];
    expect(tool).toBeDefined();
    expect(tool.parameters.properties).toHaveProperty("folder");
    expect(tool.parameters.properties).toHaveProperty("limit");
    expect(tool.parameters.properties).toHaveProperty("unread");
  });

  it("outlook_send has correct parameters", async () => {
    const { api } = await loadPlugin();
    const tool = api.tools["outlook_send"];
    expect(tool).toBeDefined();
    expect(tool.parameters.properties).toHaveProperty("to");
    expect(tool.parameters.properties).toHaveProperty("subject");
    expect(tool.parameters.properties).toHaveProperty("body");
  });

  it("outlook_calendar_fetch has correct parameters", async () => {
    const { api } = await loadPlugin();
    const tool = api.tools["outlook_calendar_fetch"];
    expect(tool).toBeDefined();
    expect(tool.parameters.properties).toHaveProperty("calendar");
    expect(tool.parameters.properties).toHaveProperty("days");
  });

  it("outlook_meeting has correct parameters", async () => {
    const { api } = await loadPlugin();
    const tool = api.tools["outlook_meeting"];
    expect(tool).toBeDefined();
    expect(tool.parameters.properties).toHaveProperty("to");
    expect(tool.parameters.properties).toHaveProperty("subject");
    expect(tool.parameters.properties).toHaveProperty("start");
  });

  it("outlook_update_event has correct parameters", async () => {
    const { api } = await loadPlugin();
    const tool = api.tools["outlook_update_event"];
    expect(tool).toBeDefined();
    expect(tool.parameters.properties).toHaveProperty("event_id");
  });

  it("outlook_query_events has correct parameters", async () => {
    const { api } = await loadPlugin();
    const tool = api.tools["outlook_query_events"];
    expect(tool).toBeDefined();
    expect(tool.parameters.properties).toHaveProperty("after");
    expect(tool.parameters.properties).toHaveProperty("before");
  });
});
