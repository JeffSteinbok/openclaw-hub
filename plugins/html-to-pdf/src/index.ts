/**
 * HTML to PDF plugin — converts HTML files to PDF using Chromium headless.
 */

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { Type } from "@sinclair/typebox";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PluginApi = {
  registerTool: (tool: unknown) => void;
  pluginConfig?: Record<string, unknown>;
};

export interface HtmlToPdfResult {
  success: boolean;
  output_path?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Chromium discovery and invocation
// ---------------------------------------------------------------------------

const CHROMIUM_PATHS = ["chromium-browser", "chromium", "google-chrome"];

async function resolvedPaths(): Promise<string[]> {
  const found: string[] = [];
  for (const bin of CHROMIUM_PATHS) {
    try {
      const { stdout } = await execFileAsync("which", [bin]);
      found.push(stdout.trim());
    } catch {
      // not found
    }
  }
  // Deduplicate by resolved path (chromium-browser and chromium may both point
  // to the same snap wrapper)
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

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

function formatResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data) }],
    details: {},
  };
}

function createEntry() {
  return {
    id: "html-to-pdf",
    name: "HTML to PDF",
    description: "Convert HTML files to PDF using Chromium headless",
    contracts: { tools: ["html_to_pdf"] },
    register(api: PluginApi) {
      api.registerTool({
        name: "html_to_pdf",
        label: "HTML to PDF",
        description: "Convert an HTML file to PDF using Chromium headless.",
        parameters: Type.Object({
          input_path: Type.String({
            description: "Absolute path to the HTML file to render",
          }),
          output_path: Type.String({
            description: "Absolute path where the PDF should be saved (must end in .pdf)",
          }),
          timeout_ms: Type.Optional(
            Type.Number({
              description: "Max ms to wait for Chromium (default: 30000)",
            }),
          ),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const inputPath = ((params.input_path as string) ?? "").trim();
          const outputPath = ((params.output_path as string) ?? "").trim();
          const timeoutMs =
            typeof params.timeout_ms === "number" ? params.timeout_ms : 30000;

          if (!inputPath) {
            return formatResult({ success: false, error: "input_path is required" });
          }
          if (!outputPath) {
            return formatResult({ success: false, error: "output_path is required" });
          }

          return formatResult(await htmlToPdf(inputPath, outputPath, timeoutMs));
        },
      });
    },
  };
}

export { createEntry };
