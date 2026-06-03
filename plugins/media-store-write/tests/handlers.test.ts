/**
 * Tests for media-store-write handlers.
 * Run with: vitest run
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleMediaWrite } from "../src/handlers.js";

describe("handleMediaWrite", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "media-store-write-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes a PNG and returns file path", async () => {
    // 1x1 transparent PNG
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    const result = await handleMediaWrite(tmpDir, {
      base64: pngBase64,
      mimeType: "image/png",
      filename: "screenshot",
    });

    expect(result).not.toHaveProperty("error");
    const r = result as { file: string; size_bytes: number; mimeType: string };
    expect(r.file).toMatch(/screenshot_\d+_[0-9a-f]{8}\.png$/);
    expect(r.size_bytes).toBeGreaterThan(0);
    expect(r.mimeType).toBe("image/png");
    expect(fs.existsSync(r.file)).toBe(true);

    const written = fs.readFileSync(r.file);
    expect(written.length).toBe(r.size_bytes);
  });

  it("uses default filename 'media' when not provided", async () => {
    const result = await handleMediaWrite(tmpDir, {
      base64: "SGVsbG8gV29ybGQ=", // "Hello World"
      mimeType: "text/plain",
    });

    expect(result).not.toHaveProperty("error");
    const r = result as { file: string };
    expect(r.file).toMatch(/media_\d+_[0-9a-f]{8}\.txt$/);
  });

  it("handles URL-safe base64", async () => {
    // Encode a known string using URL-safe base64
    const plain = Buffer.from("Hello World!").toString("base64url");
    const result = await handleMediaWrite(tmpDir, {
      base64: plain,
      mimeType: "text/plain",
    });
    expect(result).not.toHaveProperty("error");
    const r = result as { file: string; size_bytes: number };
    expect(r.size_bytes).toBe(12); // "Hello World!" is 12 bytes
  });

  it("returns error for empty base64", async () => {
    const result = await handleMediaWrite(tmpDir, {
      base64: "",
      mimeType: "image/png",
    });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/base64 is required/i);
  });

  it("returns error for empty mimeType", async () => {
    const result = await handleMediaWrite(tmpDir, {
      base64: "SGVsbG8=",
      mimeType: "",
    });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/mimeType is required/i);
  });

  it("sanitises filename to prevent path traversal", async () => {
    const result = await handleMediaWrite(tmpDir, {
      base64: "SGVsbG8=",
      mimeType: "text/plain",
      filename: "../../etc/passwd",
    });
    expect(result).not.toHaveProperty("error");
    const r = result as { file: string };
    // The file must be inside tmpDir, not in /etc
    expect(r.file.startsWith(tmpDir)).toBe(true);
  });

  it("creates the media directory if missing", async () => {
    const nestedDir = path.join(tmpDir, "a", "b", "c");
    expect(fs.existsSync(nestedDir)).toBe(false);

    const result = await handleMediaWrite(nestedDir, {
      base64: "SGVsbG8=",
      mimeType: "text/plain",
    });
    expect(result).not.toHaveProperty("error");
    expect(fs.existsSync(nestedDir)).toBe(true);
  });

  it("uses bin extension for unknown mime type", async () => {
    const result = await handleMediaWrite(tmpDir, {
      base64: "SGVsbG8=",
      mimeType: "application/x-custom-thing",
    });
    expect(result).not.toHaveProperty("error");
    const r = result as { file: string };
    expect(r.file).toMatch(/\.bin$/);
  });
});
