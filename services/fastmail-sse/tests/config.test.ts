/**
 * Tests for config loading.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as config from "../src/config.js";

// We need to mock fs and process.exit for these tests
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

describe("TestConfigLoading", () => {
  const mockExistsSync = fs.existsSync as ReturnType<typeof vi.fn>;
  const mockReadFileSync = fs.readFileSync as ReturnType<typeof vi.fn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should load valid runtime configuration file", () => {
    const configData = {
      accounts: {
        test123: { label: "test@example.com" },
      },
      mail_rules: [
        {
          id: "notify-all",
          accounts: ["test123"],
          actions: [{ name: "notify_email" }],
        },
      ],
    };

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(configData));

    const result = config.loadRuntimeConfig();
    expect(result.accounts["test123"].label).toBe("test@example.com");
    expect(result.mail_rules![0].id).toBe("notify-all");
  });

  it("should exit when config file doesn't exist", () => {
    mockExistsSync.mockReturnValue(false);

    expect(() => config.loadRuntimeConfig()).toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("should exit when config file contains invalid JSON", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("invalid json {");

    expect(() => config.loadRuntimeConfig()).toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("should exit when config has no accounts", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ accounts: {} }));

    expect(() => config.loadRuntimeConfig()).toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("should reject legacy accounts.*.rules entries", () => {
    const configData = {
      accounts: {
        acct1: { label: "Account 1", rules: ["notify_all"] },
      },
      mail_rules: [],
    };

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(configData));

    expect(() => config.loadRuntimeConfig()).toThrow("process.exit");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("accounts.*.rules is no longer supported"),
    );
  });
});
