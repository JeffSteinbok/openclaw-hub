/**
 * Tests for state persistence.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

vi.mock("../src/config.js", () => ({
  STATE_FILE: "/mock/.openclaw/services/fastmail-sse-state.json",
  log: vi.fn(),
}));

import { loadState, saveState } from "../src/state.js";

describe("TestStateManagement", () => {
  const mockExistsSync = fs.existsSync as ReturnType<typeof vi.fn>;
  const mockReadFileSync = fs.readFileSync as ReturnType<typeof vi.fn>;
  const mockWriteFileSync = fs.writeFileSync as ReturnType<typeof vi.fn>;
  const mockRenameSync = fs.renameSync as ReturnType<typeof vi.fn>;
  const mockMkdirSync = fs.mkdirSync as ReturnType<typeof vi.fn>;

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should load state from existing file", () => {
    const stateData = { EmailStates: { acct1: "state123" } };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(stateData));

    const result = loadState();
    expect(result).toEqual(stateData);
  });

  it("should return empty dict when file doesn't exist", () => {
    mockExistsSync.mockReturnValue(false);

    const result = loadState();
    expect(result).toEqual({});
  });

  it("should return empty dict when file is corrupt", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("invalid json {");

    const result = loadState();
    expect(result).toEqual({});
  });

  it("should save state to file atomically", () => {
    const stateData = { EmailStates: { acct1: "state456" } };

    saveState(stateData);

    // Verify file was written
    expect(mockWriteFileSync).toHaveBeenCalled();
    // Verify atomic replace was used
    expect(mockRenameSync).toHaveBeenCalledOnce();
  });
});
