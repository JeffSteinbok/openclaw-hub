/**
 * HTML to PDF plugin — OpenClaw plugin shim.
 *
 * Constructs config from pluginConfig, registers tools that delegate to handlers.
 */

import { Type } from "@sinclair/typebox";
import { htmlToPdf, type HtmlToPdfResult } from "./handlers.js";

// Re-export for consumers and tests
export { htmlToPdf };
export type { HtmlToPdfResult };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PluginApi = {
  registerTool: (tool: unknown) => void;
  pluginConfig?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data) }],
    details: {},
  };
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

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
