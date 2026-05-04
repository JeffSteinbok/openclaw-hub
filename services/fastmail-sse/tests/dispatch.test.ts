/**
 * Tests for result dispatch.
 */

import { describe, it, expect, vi } from "vitest";
import { dispatchResults } from "../src/dispatch.js";
import type { ActionResult } from "@openclaw/mail-runtime-core";

// Mock the config module's log function
vi.mock("../src/config.js", () => ({
  log: vi.fn(),
  STATE_FILE: "/mock/state.json",
  CONFIG_FILE: "/mock/config.json",
}));

// Mock child_process
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

describe("TestResultDispatch", () => {
  it("should route known result kinds", async () => {
    const { log } = await import("../src/config.js");
    const { execFileSync } = await import("node:child_process");
    const mockLog = log as ReturnType<typeof vi.fn>;
    const mockExec = execFileSync as ReturnType<typeof vi.fn>;

    mockLog.mockClear();
    mockExec.mockClear();

    const results: ActionResult[] = [
      { kind: "message", payload: { message: "hello" } },
      {
        kind: "agent_handoff",
        payload: { agent: "mail", message: "digest payload" },
      },
      { kind: "log", payload: { message: "note" } },
    ];

    dispatchResults(results, { channel: "discord", target: "test-target" });

    // "message" kind → deliver → execFileSync for "openclaw message send"
    expect(mockExec).toHaveBeenCalledWith(
      "openclaw",
      expect.arrayContaining(["message", "send", "--message", "hello"]),
      expect.any(Object),
    );

    // "agent_handoff" kind → handoffToAgent → execFileSync for "openclaw agent"
    expect(mockExec).toHaveBeenCalledWith(
      "openclaw",
      expect.arrayContaining(["agent", "--agent", "mail", "--message", "digest payload"]),
      expect.any(Object),
    );

    // "log" kind → logger called with message
    expect(mockLog).toHaveBeenCalledWith("note");
  });

  it("should log unknown result kinds", async () => {
    const { log } = await import("../src/config.js");
    const mockLog = log as ReturnType<typeof vi.fn>;
    mockLog.mockClear();

    const results: ActionResult[] = [
      { kind: "unknown", payload: { message: "ignored" } },
    ];

    dispatchResults(results, { channel: "discord", target: "test-target" });

    expect(mockLog).toHaveBeenCalledWith(
      "warn: unknown action result kind unknown",
    );
  });
});
