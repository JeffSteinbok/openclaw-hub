/**
 * Markdown to HTML plugin — OpenClaw plugin shim.
 */

import { definePlugin } from "carapace-plugin-sdk";
import { Type } from "@sinclair/typebox";
import {
  mdToHtml,
  reportRender,
  parseBlocks,
  extractStyles,
  SYNTAX_REFERENCE,
  type MdToHtmlResult,
  type ReportRenderResult,
  type Block,
} from "./handlers.js";

// Re-export for consumers and tests
export { mdToHtml, reportRender, parseBlocks, extractStyles, SYNTAX_REFERENCE };
export { type MdToHtmlResult, type ReportRenderResult, type Block };

export const createEntry = definePlugin({
  id: "md-to-html",
  name: "Markdown to HTML",
  description: "Convert styled Markdown reports to HTML using a CSS template",
  contracts: { tools: ["md_to_html", "md_to_html_syntax", "report_render"] },

  tools: (tool) => [
    tool({
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
      async execute({ input_path, output_path, template_path }) {
        const inputPath = input_path.trim();
        const outputPath = output_path.trim();
        const templatePath = template_path.trim();

        if (!inputPath) return { success: false, error: "input_path is required" };
        if (!outputPath) return { success: false, error: "output_path is required" };
        if (!templatePath) return { success: false, error: "template_path is required" };

        try {
          return await mdToHtml(inputPath, outputPath, templatePath);
        } catch (e) {
          return { success: false, error: `md_to_html crashed: ${e instanceof Error ? e.message : String(e)}` };
        }
      },
    }),

    tool({
      name: "md_to_html_syntax",
      label: "Markdown to HTML — Syntax Reference",
      description:
        "Returns the full Markdown syntax reference for the md_to_html renderer. " +
        "Call this to learn what fenced blocks, inline hints, table row hints, and directives are supported.",
      parameters: Type.Object({}),
      async execute() {
        return SYNTAX_REFERENCE;
      },
    }),

    tool({
      name: "report_render",
      label: "Report Render (multi-section)",
      description:
        "Render a multi-section report to HTML from a folder containing an INDEX.json with assembly_order. " +
        "Reads section .md files in order, concatenates them, renders HTML using the provided CSS template. " +
        "Use this instead of md_to_html when the report is split into per-section files.",
      parameters: Type.Object({
        folder_path: Type.String({
          description: "Absolute path to the folder containing INDEX.json and section .md files",
        }),
        output_html_path: Type.String({
          description: "Absolute path where the rendered HTML should be saved (must end in .html)",
        }),
        template_path: Type.String({
          description: "Absolute path to an HTML template containing CSS <style> blocks",
        }),
      }),
      async execute({ folder_path, output_html_path, template_path }) {
        if (!folder_path?.trim()) return { success: false, error: "folder_path is required" };
        if (!output_html_path?.trim()) return { success: false, error: "output_html_path is required" };
        if (!template_path?.trim()) return { success: false, error: "template_path is required" };
        try {
          return await reportRender(folder_path.trim(), output_html_path.trim(), template_path.trim());
        } catch (e) {
          return { success: false, error: `report_render crashed: ${e instanceof Error ? e.message : String(e)}` };
        }
      },
    }),
  ],
});
