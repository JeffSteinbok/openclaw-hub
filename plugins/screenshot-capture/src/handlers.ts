/**
 * screenshot-capture — core handler.
 *
 * Shells out to `openclaw nodes invoke` with `screen.snapshot`,
 * decodes the base64 response, writes to disk, and returns a file path
 * that the gateway auto-converts to a mediaId.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_OUT_DIR = "/tmp/openclaw/screenshots";
const DEFAULT_INVOKE_TIMEOUT = 30_000;

export interface ScreenshotParams {
  node: string;
  screenIndex?: number;
  quality?: number;
  format?: "png" | "jpeg";
}

export interface ScreenshotConfig {
  outDir: string;
  openclawBin: string;
  gatewayUrl?: string;
  gatewayToken?: string;
  invokeTimeout: number;
}

export interface ScreenshotResult {
  file: string;
  width?: number;
  height?: number;
  format: string;
  size_bytes: number;
  node: string;
}

function sanitizeNodeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase().slice(0, 32) || "node";
}

function execPromise(
  bin: string,
  args: string[],
  timeoutMs: number
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        // The openclaw CLI writes its JSON payload and then hangs (does not self-exit).
        // execFile kills it on timeout and sets err.killed=true, but stdout is fully
        // written by then. Treat a killed process the same as success so the caller
        // can still parse the JSON.
        if (err.killed && stdout && stdout.trim().length > 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(new Error(`openclaw nodes invoke failed: ${err.message}\nstderr: ${stderr}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

export async function screenshotCapture(
  config: ScreenshotConfig,
  params: ScreenshotParams
): Promise<ScreenshotResult | { error: string }> {
  const { node } = params;
  const screenIndex = params.screenIndex ?? 0;
  const quality = params.quality ?? 90;
  const format = params.format ?? "png";

  if (!node || node.trim() === "") {
    return { error: "node is required" };
  }
  if (!["png", "jpeg"].includes(format)) {
    return { error: `format must be "png" or "jpeg", got "${format}"` };
  }

  // Build the invoke params for screen.snapshot
  const invokeParams = JSON.stringify({ screenIndex, quality, format });

  const args = [
    "nodes", "invoke",
    "--node", node.trim(),
    "--command", "screen.snapshot",
    "--params", invokeParams,
    "--json",
    "--invoke-timeout", String(config.invokeTimeout),
  ];

  if (config.gatewayUrl) {
    args.push("--url", config.gatewayUrl);
  }
  if (config.gatewayToken) {
    args.push("--token", config.gatewayToken);
  }

  // Call openclaw nodes invoke
  let stdout: string;
  try {
    const result = await execPromise(config.openclawBin, args, config.invokeTimeout + 5000);
    stdout = result.stdout;
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  // Parse the JSON response
  let response: Record<string, unknown>;
  try {
    response = JSON.parse(stdout);
  } catch {
    return { error: `Failed to parse invoke response as JSON: ${stdout.slice(0, 500)}` };
  }

  // Extract base64 payload — response structure may vary
  const payload = (response.payload ?? response.result ?? response) as Record<string, unknown>;
  const base64 = (payload.base64 ?? payload.data ?? payload.image) as string | undefined;

  if (!base64 || typeof base64 !== "string" || base64.trim() === "") {
    return {
      error: `No base64 image data in response. Keys: ${Object.keys(payload).join(", ")}. ` +
        `Raw (truncated): ${stdout.slice(0, 300)}`,
    };
  }

  // Decode base64
  let buf: Buffer;
  try {
    buf = Buffer.from(base64, "base64");
    if (buf.length === 0) {
      return { error: "base64 decoded to empty buffer" };
    }
  } catch (e: unknown) {
    return { error: `Failed to decode base64: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Write to disk
  const ts = new Date().toISOString().replace(/[-:T]/g, "").replace(/\..+$/, "");
  const rand = crypto.randomBytes(4).toString("hex");
  const nodeName = sanitizeNodeName(node);
  const ext = format === "jpeg" ? "jpg" : "png";
  const fileName = `${nodeName}_${ts}_${rand}.${ext}`;

  try {
    fs.mkdirSync(config.outDir, { recursive: true });
  } catch (e: unknown) {
    return { error: `Failed to create output dir: ${e instanceof Error ? e.message : String(e)}` };
  }

  const filePath = path.join(config.outDir, fileName);
  try {
    fs.writeFileSync(filePath, buf);
  } catch (e: unknown) {
    return { error: `Failed to write file: ${e instanceof Error ? e.message : String(e)}` };
  }

  return {
    file: filePath,
    width: typeof payload.width === "number" ? payload.width : undefined,
    height: typeof payload.height === "number" ? payload.height : undefined,
    format,
    size_bytes: buf.length,
    node,
  };
}
