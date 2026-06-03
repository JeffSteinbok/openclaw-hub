/**
 * Tests for screenshot-capture handlers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as child_process from "node:child_process";
import { screenshotCapture, type ScreenshotConfig } from "../src/handlers.js";

// Mock execFile
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof child_process>("node:child_process");
  return { ...actual, execFile: vi.fn() };
});

const mockExecFile = vi.mocked(child_process.execFile);

// 1x1 red PNG as base64
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/58BAwAI/AL+hc2rNAAAAABJRU5ErkJggg==";

describe("screenshotCapture", () => {
  let tmpDir: string;
  let config: ScreenshotConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "screenshot-test-"));
    config = {
      outDir: tmpDir,
      openclawBin: "/usr/bin/openclaw",
      invokeTimeout: 30000,
    };
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function mockInvokeSuccess(payload: Record<string, unknown>) {
    mockExecFile.mockImplementation((_bin, _args, _opts, callback) => {
      const cb = callback as (err: Error | null, stdout: string, stderr: string) => void;
      cb(null, JSON.stringify({ payload }), "");
      return {} as ReturnType<typeof child_process.execFile>;
    });
  }

  function mockInvokeError(message: string) {
    mockExecFile.mockImplementation((_bin, _args, _opts, callback) => {
      const cb = callback as (err: Error | null, stdout: string, stderr: string) => void;
      cb(new Error(message), "", "connection refused");
      return {} as ReturnType<typeof child_process.execFile>;
    });
  }

  it("captures screenshot and writes to disk", async () => {
    mockInvokeSuccess({ base64: TINY_PNG_BASE64, width: 1, height: 1 });

    const result = await screenshotCapture(config, {
      node: "Windows Node (JEFFOFFICE3)",
    });

    expect(result).not.toHaveProperty("error");
    const r = result as { file: string; size_bytes: number; format: string; node: string };
    expect(r.file).toMatch(/windowsnodejeffoffice3_\d+_[0-9a-f]{8}\.png$/);
    expect(r.size_bytes).toBeGreaterThan(0);
    expect(r.format).toBe("png");
    expect(r.node).toBe("Windows Node (JEFFOFFICE3)");
    expect(fs.existsSync(r.file)).toBe(true);
  });

  it("passes correct args to openclaw CLI", async () => {
    mockInvokeSuccess({ base64: TINY_PNG_BASE64 });

    await screenshotCapture(config, {
      node: "MyNode",
      screenIndex: 1,
      quality: 75,
      format: "jpeg",
    });

    expect(mockExecFile).toHaveBeenCalledOnce();
    const args = mockExecFile.mock.calls[0][1] as string[];
    expect(args).toContain("--node");
    expect(args).toContain("MyNode");
    expect(args).toContain("--command");
    expect(args).toContain("screen.snapshot");
    expect(args).toContain("--json");

    const paramsIdx = args.indexOf("--params");
    const params = JSON.parse(args[paramsIdx + 1]);
    expect(params.screenIndex).toBe(1);
    expect(params.quality).toBe(75);
    expect(params.format).toBe("jpeg");
  });

  it("uses jpeg extension for jpeg format", async () => {
    mockInvokeSuccess({ base64: TINY_PNG_BASE64 });

    const result = await screenshotCapture(config, {
      node: "Node1",
      format: "jpeg",
    });

    expect(result).not.toHaveProperty("error");
    expect((result as { file: string }).file).toMatch(/\.jpg$/);
  });

  it("extracts width and height from response", async () => {
    mockInvokeSuccess({ base64: TINY_PNG_BASE64, width: 1920, height: 1080 });

    const result = await screenshotCapture(config, { node: "Node1" });

    expect(result).not.toHaveProperty("error");
    const r = result as { width: number; height: number };
    expect(r.width).toBe(1920);
    expect(r.height).toBe(1080);
  });

  it("returns error for empty node", async () => {
    const result = await screenshotCapture(config, { node: "" });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/node is required/i);
  });

  it("returns error for invalid format", async () => {
    const result = await screenshotCapture(config, {
      node: "Node1",
      format: "bmp" as "png",
    });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/format must be/i);
  });

  it("returns error when CLI fails", async () => {
    mockInvokeError("Command timed out");

    const result = await screenshotCapture(config, { node: "Node1" });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/failed/i);
  });

  it("returns error when response has no base64", async () => {
    mockInvokeSuccess({ width: 1920, height: 1080 });

    const result = await screenshotCapture(config, { node: "Node1" });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/no base64/i);
  });

  it("returns error for non-JSON response", async () => {
    mockExecFile.mockImplementation((_bin, _args, _opts, callback) => {
      const cb = callback as (err: Error | null, stdout: string, stderr: string) => void;
      cb(null, "Not JSON at all", "");
      return {} as ReturnType<typeof child_process.execFile>;
    });

    const result = await screenshotCapture(config, { node: "Node1" });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/parse/i);
  });

  it("includes gateway URL and token when configured", async () => {
    mockInvokeSuccess({ base64: TINY_PNG_BASE64 });

    const cfgWithAuth: ScreenshotConfig = {
      ...config,
      gatewayUrl: "ws://192.168.1.18:18789",
      gatewayToken: "secret123",
    };

    await screenshotCapture(cfgWithAuth, { node: "Node1" });

    const args = mockExecFile.mock.calls[0][1] as string[];
    expect(args).toContain("--url");
    expect(args).toContain("ws://192.168.1.18:18789");
    expect(args).toContain("--token");
    expect(args).toContain("secret123");
  });

  it("handles response with data key instead of base64", async () => {
    // Some responses may use "data" or "image" instead of "base64"
    mockExecFile.mockImplementation((_bin, _args, _opts, callback) => {
      const cb = callback as (err: Error | null, stdout: string, stderr: string) => void;
      cb(null, JSON.stringify({ payload: { data: TINY_PNG_BASE64 } }), "");
      return {} as ReturnType<typeof child_process.execFile>;
    });

    const result = await screenshotCapture(config, { node: "Node1" });
    expect(result).not.toHaveProperty("error");
    expect(fs.existsSync((result as { file: string }).file)).toBe(true);
  });

  it("creates output directory if missing", async () => {
    const nestedDir = path.join(tmpDir, "a", "b", "c");
    const cfg: ScreenshotConfig = { ...config, outDir: nestedDir };
    mockInvokeSuccess({ base64: TINY_PNG_BASE64 });

    const result = await screenshotCapture(cfg, { node: "Node1" });
    expect(result).not.toHaveProperty("error");
    expect(fs.existsSync(nestedDir)).toBe(true);
  });
});
