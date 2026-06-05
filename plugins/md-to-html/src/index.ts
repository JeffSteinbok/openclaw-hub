/**
 * Markdown to HTML plugin — OpenClaw plugin shim.
 */

import { definePlugin } from "carapace-plugin-sdk";
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

export const createEntry = definePlugin({
  id: "md-to-html",
  name: "Markdown to HTML",
  description: "Convert styled Markdown reports to HTML using a CSS template",
  contracts: { tools: ["md_to_html", "md_to_html_syntax"] },

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
  ],
});
