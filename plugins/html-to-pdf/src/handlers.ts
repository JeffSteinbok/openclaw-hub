/**
 * HTML to PDF — core handlers.
 *
 * Pure logic with no knowledge of how it's invoked (plugin vs CLI).
 */

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HtmlToPdfResult {
  success: boolean;
  output_path?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Chromium discovery and invocation
// ---------------------------------------------------------------------------

export const CHROMIUM_PATHS = ["chromium-browser", "chromium", "google-chrome"];

export async function resolvedPaths(): Promise<string[]> {
  const found: string[] = [];
  for (const bin of CHROMIUM_PATHS) {
    try {
      const { stdout } = await execFileAsync("which", [bin]);
      found.push(stdout.trim());
    } catch {
      // not found
    }
  }
  return [...new Set(found)];
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

export async function htmlToPdf(
  inputPath: string,
  outputPath: string,
  timeoutMs = 30000,
): Promise<HtmlToPdfResult> {
  if (!outputPath.endsWith(".pdf")) {
    return { success: false, error: "output_path must end with .pdf" };
  }

  try {
    await access(inputPath);
  } catch {
    return { success: false, error: `Input file not found: ${inputPath}` };
  }

  const paths = await resolvedPaths();
  if (paths.length === 0) {
    return {
      success: false,
      error: "Chromium not found. Install chromium-browser, chromium, or google-chrome.",
    };
  }

  const args = [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    `--print-to-pdf=${outputPath}`,
    `file://${inputPath}`,
  ];

  let lastError = "Chromium did not produce the output file.";

  for (const bin of paths) {
    try {
      await execFileAsync(bin, args, { timeout: timeoutMs });
    } catch (e: unknown) {
      lastError = e instanceof Error ? e.message : String(e);
      continue;
    }
    // Verify the file was actually written (snap sandboxes may silently drop it)
    try {
      await access(outputPath);
      return { success: true, output_path: outputPath };
    } catch {
      // Binary exited 0 but didn't produce the file — try the next one
    }
  }

  return { success: false, error: lastError };
}
