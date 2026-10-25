import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { CONDENSERS } from "../src/condense.js";
import { fillPrompt, resolveRange } from "../src/tools.js";
import exampleConfig from "../tools.example.json" with { type: "json" };

const base = { name: "t", agent: "external" };
const read = { name: "status", description: "d", kind: "read", invoke: [{ tool: "x" }] };

describe("parseConfig", () => {
  it("accepts the example config", () => {
    expect(parseConfig(exampleConfig).tools.map((t) => t.name)).toEqual(["house_status", "calendar", "control_house", "send_message"]);
  });

  it.each([
    ["no tools", { ...base, tools: [] }, "non-empty"],
    ["duplicate names", { ...base, tools: [read, read] }, "duplicate"],
    ["two actions", { ...base, tools: [{ ...read, send: true }] }, "exactly one"],
    ["send that isn't a change", { ...base, tools: [{ name: "s", description: "d", kind: "read", send: true }] }, "send tools"],
    [
      "read tool with free text into an agent",
      { ...base, tools: [{ name: "r", description: "d", kind: "read", params: { q: { type: "string" } }, ask: { prompt: "{q}" } }] },
      "free-text",
    ],
    [
      "prompt naming a missing parameter",
      { ...base, tools: [{ name: "c", description: "d", kind: "change", ask: { prompt: "do {thing}" } }] },
      "{thing}",
    ],
  ])("rejects %s", (_label, raw, message) => {
    expect(() => parseConfig(raw)).toThrow(message);
  });
});

describe("resolveRange", () => {
  const sunday = new Date("2026-10-25T18:00:00Z"); // Sunday in America/Los_Angeles
  const tz = "America/Los_Angeles";
  it("maps named ranges", () => {
    expect(resolveRange({}, tz, sunday)).toMatchObject({ after: "2026-10-25", before: "2026-10-25" });
    expect(resolveRange({ range: "tomorrow" }, tz, sunday)).toMatchObject({ after: "2026-10-26", before: "2026-10-26" });
    expect(resolveRange({ range: "this_week" }, tz, sunday)).toMatchObject({ after: "2026-10-25", before: "2026-10-25" });
    expect(resolveRange({ range: "this_week" }, tz, new Date("2026-10-21T18:00:00Z"))).toMatchObject({
      after: "2026-10-21",
      before: "2026-10-25",
    });
    expect(resolveRange({ range: "next_7_days" }, tz, sunday)).toMatchObject({ after: "2026-10-25", before: "2026-10-31" });
  });

  it("uses the configured timezone for today", () => {
    // 06:00 UTC on the 26th is still the 25th in Los Angeles.
    expect(resolveRange({}, tz, new Date("2026-10-26T06:00:00Z"))).toMatchObject({ after: "2026-10-25" });
  });

  it("validates explicit dates", () => {
    expect(resolveRange({ start: "2026-11-01", end: "2026-11-03" }, tz, sunday)).toMatchObject({ after: "2026-11-01", before: "2026-11-03" });
    expect(resolveRange({ start: "2026-11-03", end: "2026-11-01" }, tz, sunday)).toHaveProperty("error");
    expect(resolveRange({ start: "2026-11-03" }, tz, sunday)).toHaveProperty("error");
  });
});

describe("fillPrompt", () => {
  it("quotes strings and inserts validated values as-is", () => {
    const specs = { request: { type: "string" as const }, room: { type: "enum" as const, values: ["office"] } };
    expect(fillPrompt("{room}: {request}", { room: "office", request: 'off"\nnow' }, specs)).toBe('office: "off\\"\\nnow"');
    expect(fillPrompt("{room}", {}, specs)).toBe("(not given)");
  });
});

describe("condensers", () => {
  it("home-assistant-status skips ignored entities and idle states", () => {
    const text = CONDENSERS["home-assistant-status"](
      [
        {
          tool: "hass_state_list",
          label: "Lights",
          args: { domain: "light" },
          output: {
            output: [
              { entity_id: "light.a", state: "on", attributes: { friendly_name: "A" } },
              { entity_id: "light.led_1", state: "on" },
              { entity_id: "light.b", state: "unavailable" },
            ],
          },
        },
      ],
      { ignoreEntities: ["light.led_*"] },
    );
    expect(text).toBe("Lights on: A");
  });

  it("calendar-events sorts across calendars and handles empty", () => {
    const cal = CONDENSERS["calendar-events"];
    expect(cal([], { ignoreEntities: [] })).toBe("No events.");
    const text = cal(
      [
        { tool: "a", label: "Work", args: {}, output: { events: [{ subject: "Standup", start: "2026-10-26T09:00:00" }] } },
        { tool: "b", label: "Family", args: {}, output: { events: [{ summary: "Breakfast", start: "2026-10-26T08:00:00", location: "Home" }] } },
      ],
      { ignoreEntities: [] },
    );
    expect(text.split("\n")).toEqual(["2026-10-26T08:00:00 — Breakfast [Family] @ Home", "2026-10-26T09:00:00 — Standup [Work]"]);
  });
});
