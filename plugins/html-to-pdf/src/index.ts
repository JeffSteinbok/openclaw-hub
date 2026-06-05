/**
 * HTML to PDF plugin — OpenClaw plugin shim.
 */

import { definePlugin } from "carapace-plugin-sdk";
import { Type } from "@sinclair/typebox";
import { htmlToPdf, type HtmlToPdfResult } from "./handlers.js";

// Re-export for consumers and tests
export { htmlToPdf };
export type { HtmlToPdfResult };

export const createEntry = definePlugin({
  id: "html-to-pdf",
  name: "HTML to PDF",
  description: "Convert HTML files to PDF using Chromium headless",
  contracts: { tools: ["html_to_pdf"] },

  tools: (tool) => [
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
        const inputPath = input_path.trim();
        const outputPath = output_path.trim();
        const timeoutMs = timeout_ms ?? 30000;

        if (!inputPath) {
          return { success: false, error: "input_path is required" };
        }
        if (!outputPath) {
          return { success: false, error: "output_path is required" };
        }

        return await htmlToPdf(inputPath, outputPath, timeoutMs);
      },
    }),
  ],
});
