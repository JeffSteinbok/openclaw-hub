/**
 * Markdown to HTML plugin — converts styled Markdown reports to HTML
 * using a CSS template file. Supports fenced blocks (kpi, callout, svg,
 * two-col), table row class hints, and inline text transforms.
 */

import { readFile, writeFile, access, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PluginApi = {
  registerTool: (tool: unknown) => void;
  pluginConfig?: Record<string, unknown>;
};

export interface MdToHtmlResult {
  success: boolean;
  output_path?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Inline transforms (applied after escaping)
// ---------------------------------------------------------------------------

function renderInline(text: string): string {
  let s = esc(text);

  // Bold: **text**
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic: _text_ (not inside words)
  s = s.replace(/(?<![a-zA-Z0-9])_(.+?)_(?![a-zA-Z0-9])/g, "<em>$1</em>");

  // Custom inline hints
  s = s.replace(/!!warn!!(.+?)(?=!!|$)/g, '<span class="warn">$1</span>');
  s = s.replace(/!!good!!(.+?)(?=!!|$)/g, '<span class="good">$1</span>');
  s = s.replace(/\[ROTH\]/g, '<span class="roth">Roth</span>');
  s = s.replace(/\[PRETAX\]/g, '<span class="pretax">Pre-tax</span>');
  s = s.replace(/\[TAXABLE\]/g, '<span class="taxable-tag">Taxable</span>');
  s = s.replace(/\[TAG:(\w+)\]([^[]*?)(?=\[TAG:|\s*$|<)/g,
    (_m, tag: string, content: string) => `<span class="tag tag-${tag}">${content.trim()}</span>`);

  // Markdown links: [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  return s;
}

// ---------------------------------------------------------------------------
// Block types
// ---------------------------------------------------------------------------

type Block =
  | { type: "heading"; level: number; text: string; id?: string }
  | { type: "hr" }
  | { type: "paragraph"; text: string }
  | { type: "blockquote"; text: string }
  | { type: "table"; rows: string[][] ; headerRow: boolean; rowHints: (string | null)[] }
  | { type: "fenced"; tag: string; lines: string[] }
  | { type: "directive"; kind: string; content: string }
  | { type: "blank" };

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseBlocks(md: string): Block[] {
  const lines = md.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced block
    if (/^```(\w[\w-]*)/.test(line)) {
      const tag = line.match(/^```(\w[\w-]*)/)![1];
      const fencedLines: string[] = [];
      i++;
      while (i < lines.length && lines[i] !== "```") {
        fencedLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push({ type: "fenced", tag, lines: fencedLines });
      continue;
    }

    // Directive: <!-- pb -->
    if (/^<!--\s*pb\s*-->/.test(line.trim())) {
      blocks.push({ type: "directive", kind: "pb", content: "" });
      i++;
      continue;
    }

    // Directive: <!-- note: text -->
    const noteMatch = line.trim().match(/^<!--\s*note:\s*(.+?)\s*-->$/);
    if (noteMatch) {
      blocks.push({ type: "directive", kind: "note", content: noteMatch[1] });
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      let id: string | undefined;
      // Extract section number for id: "## 3. Title" → id="s3"
      const numMatch = text.match(/^(\d+)\.\s/);
      if (numMatch && level === 2) {
        id = `s${numMatch[1]}`;
      }
      blocks.push({ type: "heading", level, text, id });
      i++;
      continue;
    }

    // HR
    if (/^---+\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      blocks.push({ type: "blockquote", text: quoteLines.join(" ") });
      continue;
    }

    // Table
    if (line.includes("|") && line.trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      // Parse table
      const parsed = parseTable(tableLines);
      blocks.push(parsed);
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      blocks.push({ type: "blank" });
      i++;
      continue;
    }

    // Paragraph (collect contiguous non-blank, non-special lines)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith("```") &&
      !lines[i].startsWith("> ") &&
      !/^---+\s*$/.test(lines[i]) &&
      !(lines[i].includes("|") && lines[i].trim().startsWith("|")) &&
      !/^<!--\s*(pb|note:)/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: "paragraph", text: paraLines.join("\n") });
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Table parsing
// ---------------------------------------------------------------------------

const ROW_HINT_PATTERN = /<!--\s*([\w-]+)\s*-->$/;

function parseTable(lines: string[]): Block & { type: "table" } {
  const rows: string[][] = [];
  const rowHints: (string | null)[] = [];
  let headerRow = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    // Check for row hint comment
    let hint: string | null = null;
    const hintMatch = line.match(ROW_HINT_PATTERN);
    if (hintMatch) {
      hint = hintMatch[1];
      line = line.slice(0, hintMatch.index).trim();
    }

    // Skip separator row (|---|---|)
    if (/^\|[\s\-:|]+\|$/.test(line)) {
      headerRow = true;
      continue;
    }

    // Split cells
    const cells = line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

    rows.push(cells);
    rowHints.push(hint);
  }

  return { type: "table", rows, headerRow, rowHints };
}

// ---------------------------------------------------------------------------
// Fenced block renderers
// ---------------------------------------------------------------------------

function renderKpiBlock(lines: string[]): string {
  const cards = lines
    .filter((l) => l.trim() !== "")
    .map((line) => {
      const parts = line.split("|").map((p) => p.trim());
      const label = parts[0] || "";
      const value = parts[1] || "";
      const sub = parts[2] || "";
      return `  <div class="kpi">
    <div class="kpi-label">${renderInline(label)}</div>
    <div class="kpi-value">${renderInline(value)}</div>
    ${sub ? `<div class="kpi-sub">${renderInline(sub)}</div>` : ""}
  </div>`;
    });
  return `<div class="kpi-row">\n${cards.join("\n")}\n</div>`;
}

function renderCalloutBlock(tag: string, lines: string[]): string {
  const cssClass = tag; // callout, callout-blue, callout-good
  const items = lines
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const text = l.replace(/^[-*]\s*/, "");
      return `  <li>${renderInline(text)}</li>`;
    });
  return `<div class="${cssClass}">\n<ul>\n${items.join("\n")}\n</ul>\n</div>`;
}

function renderSvgBlock(lines: string[]): string {
  // Pass SVG through verbatim (no escaping)
  return `<div>\n${lines.join("\n")}\n</div>`;
}

function renderTwoColBlock(lines: string[]): string {
  // Split on --- separator
  const separator = lines.findIndex((l) => /^---+\s*$/.test(l));
  let leftLines: string[];
  let rightLines: string[];
  if (separator >= 0) {
    leftLines = lines.slice(0, separator);
    rightLines = lines.slice(separator + 1);
  } else {
    leftLines = lines;
    rightLines = [];
  }

  const leftHtml = renderBlockList(parseBlocks(leftLines.join("\n")));
  const rightHtml = renderBlockList(parseBlocks(rightLines.join("\n")));
  return `<div class="two-col">\n  <div>${leftHtml}</div>\n  <div>${rightHtml}</div>\n</div>`;
}

// ---------------------------------------------------------------------------
// Block renderer
// ---------------------------------------------------------------------------

function renderBlock(block: Block): string {
  switch (block.type) {
    case "heading": {
      const tag = `h${block.level}`;
      const idAttr = block.id ? ` id="${block.id}"` : "";
      return `<${tag}${idAttr}>${renderInline(block.text)}</${tag}>`;
    }
    case "hr":
      return "<hr>";
    case "paragraph":
      return `<p>${renderInline(block.text)}</p>`;
    case "blockquote":
      return `<blockquote>${renderInline(block.text)}</blockquote>`;
    case "table":
      return renderTableBlock(block);
    case "fenced":
      return renderFencedBlock(block.tag, block.lines);
    case "directive":
      if (block.kind === "pb") return '<div class="pb"></div>';
      if (block.kind === "note") return `<p class="note-sm">${renderInline(block.content)}</p>`;
      return "";
    case "blank":
      return "";
  }
}

function renderTableBlock(block: Block & { type: "table" }): string {
  const { rows, headerRow, rowHints } = block;
  if (rows.length === 0) return "";

  const lines: string[] = ["<table>"];
  let startIdx = 0;

  if (headerRow && rows.length > 0) {
    lines.push("<thead><tr>");
    for (const cell of rows[0]) {
      lines.push(`  <th>${renderInline(cell)}</th>`);
    }
    lines.push("</tr></thead>");
    startIdx = 1;
  }

  lines.push("<tbody>");
  for (let i = startIdx; i < rows.length; i++) {
    const hint = rowHints[i];
    const classAttr = hint ? ` class="${hint}"` : "";
    lines.push(`<tr${classAttr}>`);
    for (const cell of rows[i]) {
      lines.push(`  <td>${renderInline(cell)}</td>`);
    }
    lines.push("</tr>");
  }
  lines.push("</tbody>");
  lines.push("</table>");
  return lines.join("\n");
}

function renderFencedBlock(tag: string, lines: string[]): string {
  if (tag === "kpi") return renderKpiBlock(lines);
  if (tag === "svg") return renderSvgBlock(lines);
  if (tag === "two-col") return renderTwoColBlock(lines);
  if (tag.startsWith("callout")) return renderCalloutBlock(tag, lines);
  // Unknown fenced block — render as preformatted
  return `<pre><code>${esc(lines.join("\n"))}</code></pre>`;
}

// ---------------------------------------------------------------------------
// Top-level render
// ---------------------------------------------------------------------------

function renderBlockList(blocks: Block[]): string {
  return blocks
    .map(renderBlock)
    .filter((html) => html !== "")
    .join("\n");
}

// ---------------------------------------------------------------------------
// Template extraction
// ---------------------------------------------------------------------------

export function extractStyles(templateHtml: string): string {
  const styleBlocks: string[] = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(templateHtml)) !== null) {
    styleBlocks.push(match[1]);
  }
  if (styleBlocks.length === 0) {
    throw new Error("No <style> block found in template");
  }
  return styleBlocks.join("\n");
}

// ---------------------------------------------------------------------------
// Core conversion
// ---------------------------------------------------------------------------

export async function mdToHtml(
  inputPath: string,
  outputPath: string,
  templatePath: string,
): Promise<MdToHtmlResult> {
  if (!outputPath.endsWith(".html")) {
    return { success: false, error: "output_path must end with .html" };
  }

  try {
    await access(inputPath);
  } catch {
    return { success: false, error: `Input file not found: ${inputPath}` };
  }

  try {
    await access(templatePath);
  } catch {
    return { success: false, error: `Template file not found: ${templatePath}` };
  }

  const md = await readFile(inputPath, "utf-8");
  const templateHtml = await readFile(templatePath, "utf-8");

  let css: string;
  try {
    css = extractStyles(templateHtml);
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }

  const blocks = parseBlocks(md);
  const bodyHtml = renderBlockList(blocks);

  // Extract title from first h1
  const titleBlock = blocks.find((b) => b.type === "heading" && b.level === 1) as
    | (Block & { type: "heading" })
    | undefined;
  const title = titleBlock ? titleBlock.text.replace(/\*\*/g, "") : "Report";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<style>
${css}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;

  try {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, html, "utf-8");
  } catch (e) {
    return { success: false, error: `Failed to write output: ${e instanceof Error ? e.message : String(e)}` };
  }

  return { success: true, output_path: outputPath };
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

function formatResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data) }],
    details: {},
  };
}

function createEntry() {
  return {
    id: "md-to-html",
    name: "Markdown to HTML",
    description: "Convert styled Markdown reports to HTML using a CSS template",
    contracts: { tools: ["md_to_html"] },
    register(api: PluginApi) {
      api.registerTool({
        name: "md_to_html",
        label: "Markdown to HTML",
        description:
          "Convert a styled Markdown file to HTML using a CSS template. " +
          "Supports fenced blocks (kpi, callout, svg, two-col), table row class hints, and inline text transforms.",
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

          return formatResult(await mdToHtml(inputPath, outputPath, templatePath));
        },
      });
    },
  };
}

export { createEntry };
