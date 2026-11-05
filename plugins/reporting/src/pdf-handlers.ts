/**
 * HTML to PDF — core handlers.
 *
 * Pure logic with no knowledge of how it's invoked (plugin vs CLI).
 */

import { execFile } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
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

// macOS installs browsers as app bundles, off PATH.
export const MAC_APP_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

async function isFile(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// Playwright's browser cache, newest chromium-<rev> first. OpenClaw's browser tool
// installs one here, so on a Mac without Chrome it's usually the only Chromium.
export async function playwrightChromiums(
  cacheDir = join(homedir(), "Library", "Caches", "ms-playwright"),
): Promise<string[]> {
  let revs: string[];
  try {
    revs = (await readdir(cacheDir)).filter((d) => /^chromium-\d+$/.test(d));
  } catch {
    return [];
  }
  revs.sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  const found: string[] = [];
  for (const rev of revs) {
    for (const arch of ["chrome-mac-arm64", "chrome-mac-x64", "chrome-mac"]) {
      for (const app of [
        "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "Chromium.app/Contents/MacOS/Chromium",
      ]) {
        const bin = join(cacheDir, rev, arch, app);
        if (await isFile(bin)) found.push(bin);
      }
    }
  }
  return found;
}

// CHROMIUM_PATH first, then browsers on PATH, then (on macOS) app bundles and
// Playwright's cache.
export async function resolvedPaths(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const found: string[] = [];
  if (env.CHROMIUM_PATH && (await isFile(env.CHROMIUM_PATH))) found.push(env.CHROMIUM_PATH);
  for (const bin of CHROMIUM_PATHS) {
    try {
      const { stdout } = await execFileAsync("which", [bin]);
      found.push(stdout.trim());
    } catch {
      // not found
    }
  }
  if (process.platform === "darwin") {
    for (const app of MAC_APP_PATHS) if (await isFile(app)) found.push(app);
    found.push(...(await playwrightChromiums()));
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
      error: "Chromium not found. Install Chrome or Chromium, or set CHROMIUM_PATH to a Chromium binary.",
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
