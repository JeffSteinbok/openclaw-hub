/**
 * media-store-write — core handler.
 *
 * Pure logic: decode base64, validate, write to disk, return result.
 * No knowledge of plugin SDK, TypeBox, or OpenClaw APIs.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// MIME → extension mapping
// ---------------------------------------------------------------------------

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/tiff": "tif",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/html": "html",
  "application/json": "json",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "application/zip": "zip",
  "application/octet-stream": "bin",
};

function extForMime(mimeType: string): string {
  const mime = mimeType.toLowerCase().split(";")[0].trim();
  return MIME_TO_EXT[mime] ?? "bin";
}

// ---------------------------------------------------------------------------
// Filename sanitisation
// ---------------------------------------------------------------------------

/**
 * Strip path traversal and null bytes from a filename hint.
 * Returns the basename only, lowercased, non-alphanumeric replaced with _.
 */
function sanitizeFilename(name: string): string {
  // Extract basename only — no directory components
  const base = path.basename(name);
  // Strip extension — we add our own
  const noExt = base.replace(/\.[^.]+$/, "");
  // Replace unsafe chars
  const safe = noExt.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return safe || "media";
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface MediaWriteParams {
  base64: string;
  mimeType: string;
  filename?: string;
}

export interface MediaWriteResult {
  /** Absolute path to the written file. OpenClaw gateway converts this to a mediaId. */
  file: string;
  /** Human-readable media ID hint (same as file path; gateway replaces this). */
  mediaId: string;
  /** File size in bytes after decoding. */
  size_bytes: number;
  /** The MIME type that was stored. */
  mimeType: string;
}

export async function handleMediaWrite(
  mediaDir: string,
  params: MediaWriteParams
): Promise<MediaWriteResult | { error: string }> {
  const { base64, mimeType } = params;

  // --- Validate inputs ---
  if (!base64 || base64.trim() === "") {
    return { error: "base64 is required and must not be empty" };
  }
  if (!mimeType || mimeType.trim() === "") {
    return { error: "mimeType is required" };
  }

  // --- Decode base64 ---
  let buf: Buffer;
  try {
    // Accept standard base64 or URL-safe base64 (replace - and _ with + and /)
    const normalized = base64.replace(/-/g, "+").replace(/_/g, "/");
    buf = Buffer.from(normalized, "base64");
    if (buf.length === 0) {
      return { error: "base64 decoded to empty buffer — check input encoding" };
    }
  } catch (e: unknown) {
    return {
      error: `Failed to decode base64: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // --- Build output path ---
  const ts = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .replace(/\..+$/, "");
  const rand = crypto.randomBytes(4).toString("hex");
  const baseName = params.filename
    ? sanitizeFilename(params.filename)
    : "media";
  const ext = extForMime(mimeType);
  const fileName = `${baseName}_${ts}_${rand}.${ext}`;

  // --- Write to disk ---
  try {
    fs.mkdirSync(mediaDir, { recursive: true });
  } catch (e: unknown) {
    return {
      error: `Failed to create media directory '${mediaDir}': ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const filePath = path.join(mediaDir, fileName);

  try {
    fs.writeFileSync(filePath, buf);
  } catch (e: unknown) {
    return {
      error: `Failed to write file '${filePath}': ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  return {
    file: filePath,
    mediaId: filePath, // gateway will replace this with a real media ID
    size_bytes: buf.length,
    mimeType: mimeType.toLowerCase().split(";")[0].trim(),
  };
}
