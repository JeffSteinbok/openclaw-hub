/**
 * Markdown to HTML plugin — OpenClaw plugin shim.
 *
 * Constructs config from pluginConfig, registers tools that delegate to handlers.
 */

import { Type } from "@sinclair/typebox";
import {
  mdToHtml,
  parseBlocks,
  extractStyles,
  SYNTAX_REFERENCE,
  type MdToHtmlResult,
  type Block,
} from "./handlers.js";

// Re-export for consumers and tests
export { mdToHtml, parseBlocks, extractStyles, SYNTAX_REFERENCE };
export { type MdToHtmlResult, type Block };

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
    id: "md-to-html",
    name: "Markdown to HTML",
    description: "Convert styled Markdown reports to HTML using a CSS template",
    contracts: { tools: ["md_to_html", "md_to_html_syntax"] },
    register(api: PluginApi) {
      api.registerTool({
        name: "md_to_html",
        label: "Markdown to HTML",
        description:
          "Convert a styled Markdown file to HTML using a CSS template. " +
          "Supports fenced blocks (kpi, callout, svg, two-col), table row class hints, and inline text transforms. " +
          "Call md_to_html_syntax for full syntax reference.",
        parameters: Type.Object({
          input_path: Type.String({
            description: "Absolute path to the Markdown file to render",
          }),
          output_path: Type.String({
            description: "Absolute path where the HTML should be saved (must end in .html)",
          }),
          template_path: Type.String({
            description: "Absolute path to an HTML template containing CSS <style> blocks",
          }),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const inputPath = ((params.input_path as string) ?? "").trim();
          const outputPath = ((params.output_path as string) ?? "").trim();
          const templatePath = ((params.template_path as string) ?? "").trim();

          if (!inputPath) return formatResult({ success: false, error: "input_path is required" });
          if (!outputPath) return formatResult({ success: false, error: "output_path is required" });
          if (!templatePath) return formatResult({ success: false, error: "template_path is required" });

          try {
            return formatResult(await mdToHtml(inputPath, outputPath, templatePath));
          } catch (e) {
            return formatResult({ success: false, error: `md_to_html crashed: ${e instanceof Error ? e.message : String(e)}` });
          }
        },
      });

      api.registerTool({
        name: "md_to_html_syntax",
        label: "Markdown to HTML — Syntax Reference",
        description:
          "Returns the full Markdown syntax reference for the md_to_html renderer. " +
          "Call this to learn what fenced blocks, inline hints, table row hints, and directives are supported.",
        parameters: Type.Object({}),
        async execute() {
          return formatResult(SYNTAX_REFERENCE);
        },
      });
    },
  };
}

export { createEntry };
