/**
 * Reporting plugin — unified Markdown → HTML → PDF pipeline.
 *
 * Consolidates md-to-html, html-to-pdf, and report_render into a single plugin.
 *
 * Tools:
 *   md_to_html        — render a single .md file to HTML using a CSS template
 *   md_to_html_syntax — return the full Markdown syntax reference
 *   html_to_pdf       — convert an HTML file to PDF via Chromium headless
 *   report_render     — assemble a multi-section report from a folder with INDEX.json,
 *                       render to HTML (and optionally PDF in one call)
 */

import { definePlugin } from "carapace-plugin-sdk";
import { Type } from "@sinclair/typebox";
import { mdToHtml, reportRender, SYNTAX_REFERENCE, type MdToHtmlResult, type ReportRenderResult } from "./md-handlers.js";
import { htmlToPdf, type HtmlToPdfResult } from "./pdf-handlers.js";

export { mdToHtml, reportRender, htmlToPdf, SYNTAX_REFERENCE };
export type { MdToHtmlResult, ReportRenderResult, HtmlToPdfResult };

export const createEntry = definePlugin({
  id: "reporting",
  name: "Reporting",
  description: "Markdown to HTML to PDF report pipeline — single-file and multi-section assembly",
  contracts: { tools: ["md_to_html", "md_to_html_syntax", "html_to_pdf", "report_render"] },

  tools: (tool) => [
    // -------------------------------------------------------------------------
    // md_to_html — render a single Markdown file to HTML
    // -------------------------------------------------------------------------
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
        if (!input_path?.trim()) return { success: false, error: "input_path is required" };
        if (!output_path?.trim()) return { success: false, error: "output_path is required" };
        if (!template_path?.trim()) return { success: false, error: "template_path is required" };
        try {
          return await mdToHtml(input_path.trim(), output_path.trim(), template_path.trim());
        } catch (e) {
          return { success: false, error: `md_to_html crashed: ${e instanceof Error ? e.message : String(e)}` };
        }
      },
    }),

    // -------------------------------------------------------------------------
    // md_to_html_syntax — syntax reference for the MD renderer
    // -------------------------------------------------------------------------
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

    // -------------------------------------------------------------------------
    // html_to_pdf — render an HTML file to PDF via Chromium headless
    // -------------------------------------------------------------------------
    tool({
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
      async execute({ input_path, output_path, timeout_ms }) {
        if (!input_path?.trim()) return { success: false, error: "input_path is required" };
        if (!output_path?.trim()) return { success: false, error: "output_path is required" };
        try {
          return await htmlToPdf(input_path.trim(), output_path.trim(), timeout_ms ?? 30000);
        } catch (e) {
          return { success: false, error: `html_to_pdf crashed: ${e instanceof Error ? e.message : String(e)}` };
        }
      },
    }),

    // -------------------------------------------------------------------------
    // report_render — assemble multi-section report from INDEX.json folder
    // -------------------------------------------------------------------------
    tool({
      name: "report_render",
      label: "Report Render (multi-section)",
      description:
        "Render a multi-section report to HTML from a folder containing an INDEX.json with assembly_order. " +
        "Reads section .md files in order, concatenates them, renders HTML using the provided CSS template. " +
        "Use this instead of md_to_html when the report is split into per-section files (e.g. a v7.90 folder).",
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
