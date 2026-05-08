/**
 * Markdown to HTML — core handlers.
 *
 * Pure logic with no knowledge of how it's invoked (plugin vs CLI).
 */

import { readFile, writeFile, access, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MdToHtmlResult {
  success: boolean;
  output_path?: string;
  error?: string;
}

export type Block =
  | { type: "heading"; level: number; text: string; id?: string }
  | { type: "hr" }
  | { type: "paragraph"; text: string }
  | { type: "blockquote"; text: string }
  | { type: "table"; rows: string[][]; headerRow: boolean; rowHints: (string | null)[] }
  | { type: "fenced"; tag: string; lines: string[] }
  | { type: "directive"; kind: string; content: string }
  | { type: "ordered-list"; items: string[] }
  | { type: "raw"; text: string }
  | { type: "blank" };

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
  s = s.replace(
    /\[TAG:(\w+)\]([^[]*?)(?=\[TAG:|\s*$|<)/g,
    (_m, tag: string, content: string) => `<span class="tag tag-${tag}">${content.trim()}</span>`,
  );

  // Markdown links: [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  return s;
}

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
      const hasBullets = quoteLines.some((l) => l.startsWith("- "));
      if (hasBullets) {
        const parts: string[] = [];
        let currentList: string[] = [];
        for (const ql of quoteLines) {
          if (ql.startsWith("- ")) {
            currentList.push(`<li>${renderInline(ql.slice(2))}</li>`);
          } else {
            if (currentList.length) {
              parts.push(`<ul>${currentList.join("")}</ul>`);
              currentList = [];
            }
            parts.push(`<p>${renderInline(ql)}</p>`);
          }
        }
        if (currentList.length) parts.push(`<ul>${currentList.join("")}</ul>`);
        blocks.push({ type: "blockquote", text: parts.join("") });
      } else {
        blocks.push({ type: "blockquote", text: quoteLines.join(" ") });
      }
      continue;
    }

    // Table
    if (line.includes("|") && line.trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
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

    // Ordered list (1. item, 2. item, etc.)
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s*/, ""));
        i++;
      }
      blocks.push({ type: "ordered-list", items });
      continue;
    }

    // Raw HTML pass-through (lines starting with < tag)
    if (/^<(small|div|aside|figcaption)[\s>]/.test(line)) {
      blocks.push({ type: "raw", text: line });
      i++;
      continue;
    }

    // Stray closing fence (``` with no tag) — skip it to avoid infinite loop
    if (/^```\s*$/.test(line)) {
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
    } else {
      i++;
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

    let hint: string | null = null;
    const hintMatch = line.match(ROW_HINT_PATTERN);
    if (hintMatch) {
      hint = hintMatch[1];
      line = line.slice(0, hintMatch.index).trim();
    }

    if (/^\|[\s\-:|]+\|$/.test(line)) {
      headerRow = true;
      continue;
    }

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
  const cssClass = tag;
  const content: string[] = [];
  let currentList: string[] = [];

  for (const l of lines) {
    if (l.trim() === "") continue;
    if (/^[-*]\s/.test(l)) {
      const text = l.replace(/^[-*]\s*/, "");
      currentList.push(`  <li>${renderInline(text)}</li>`);
    } else {
      if (currentList.length) {
        content.push(`<ul>\n${currentList.join("\n")}\n</ul>`);
        currentList = [];
      }
      content.push(`<p>${renderInline(l)}</p>`);
    }
  }
  if (currentList.length) {
    content.push(`<ul>\n${currentList.join("\n")}\n</ul>`);
  }
  return `<div class="${cssClass}">\n${content.join("\n")}\n</div>`;
}

function renderSvgBlock(lines: string[]): string {
  return `<div>\n${lines.join("\n")}\n</div>`;
}

function renderTwoColBlock(lines: string[]): string {
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
    case "raw":
      return block.text;
    case "blockquote": {
      const content =
        block.text.includes("<ul>") || block.text.includes("<p>")
          ? block.text
          : renderInline(block.text);
      return `<blockquote>${content}</blockquote>`;
    }
    case "table":
      return renderTableBlock(block);
    case "fenced":
      return renderFencedBlock(block.tag, block.lines);
    case "directive":
      if (block.kind === "pb") return '<div class="pb"></div>';
      if (block.kind === "note") return `<p class="note-sm">${renderInline(block.content)}</p>`;
      return "";
    case "ordered-list":
      return renderOrderedList(block.items);
    case "blank":
      return "";
  }
}

function renderOrderedList(items: string[]): string {
  const listItems = items.map((item) => `  <li>${renderInline(item)}</li>`);
  return `<ol>\n${listItems.join("\n")}\n</ol>`;
}

function renderTableBlock(block: Block & { type: "table" }): string {
  const { rows, headerRow, rowHints } = block;
  if (rows.length === 0) return "";

  const lines: string[] = ["<table>"];
  let startIdx = 0;
  let actionCols: Set<number> = new Set();

  if (headerRow && rows.length > 0) {
    lines.push("<thead><tr>");
    for (let c = 0; c < rows[0].length; c++) {
      lines.push(`  <th>${renderInline(rows[0][c])}</th>`);
      if (/action/i.test(rows[0][c])) actionCols.add(c);
    }
    lines.push("</tr></thead>");
    startIdx = 1;
  }

  lines.push("<tbody>");
  for (let i = startIdx; i < rows.length; i++) {
    const hint = rowHints[i];
    const classAttr = hint ? ` class="${hint}"` : "";
    if (hint === "phase-header") {
      const colCount = headerRow ? rows[0].length : (rows[i]?.length || 1);
      const text = rows[i].filter((c) => c.trim() !== "").join(" ");
      lines.push(`<tr${classAttr}>`);
      lines.push(`  <td colspan="${colCount}">${renderInline(text).toUpperCase()}</td>`);
      lines.push("</tr>");
      continue;
    }
    lines.push(`<tr${classAttr}>`);
    for (let c = 0; c < rows[i].length; c++) {
      const isAction = actionCols.has(c);
      const cellClass = isAction ? ' class="action-q"' : "";
      let cellContent = renderInline(rows[i][c]);
      if (isAction) {
        cellContent = cellContent.replace(/;\s*/g, "<br>");
      }
      lines.push(`  <td${cellClass}>${cellContent}</td>`);
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
  return `<pre><code>${esc(lines.join("\n"))}</code></pre>`;
}

// ---------------------------------------------------------------------------
// Top-level render
// ---------------------------------------------------------------------------

function renderBlockList(blocks: Block[]): string {
  const output: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (
      block.type === "heading" &&
      /table of contents/i.test(block.text) &&
      i + 1 < blocks.length
    ) {
      let j = i + 1;
      while (j < blocks.length && blocks[j].type === "blank") j++;
      if (j < blocks.length && blocks[j].type === "ordered-list") {
        const items = (blocks[j] as { type: "ordered-list"; items: string[] }).items;
        const mid = Math.ceil(items.length / 2);
        const leftItems = items.slice(0, mid).map((item) => `    <li>${renderInline(item)}</li>`);
        const rightItems = items.slice(mid).map((item) => `    <li>${renderInline(item)}</li>`);
        output.push(`<div class="toc">`);
        output.push(`<h3>📋 Table of Contents</h3>`);
        output.push(`<div class="toc-col">`);
        output.push(`  <ol>\n${leftItems.join("\n")}\n  </ol>`);
        output.push(`  <ol start="${mid + 1}">\n${rightItems.join("\n")}\n  </ol>`);
        output.push(`</div>`);
        output.push(`</div>`);
        i = j;
        continue;
      }
    }
    const html = renderBlock(block);
    if (html !== "") output.push(html);
  }
  return output.join("\n");
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
// Syntax reference
// ---------------------------------------------------------------------------

export const SYNTAX_REFERENCE = `# md_to_html Markdown Syntax

## Fenced Blocks

\`\`\`\`
\`\`\`kpi
Label | Value | Sub-label
\`\`\`
\`\`\`\`
→ KPI card row. Each line: label | value | sub-label (sub-label optional).

\`\`\`\`
\`\`\`callout
- bullet item
\`\`\`
\`\`\`\`
→ Yellow warning box. Also: \`callout-blue\` (info), \`callout-good\` (green/positive).

\`\`\`\`
\`\`\`svg
<svg>...</svg>
\`\`\`
\`\`\`\`
→ SVG passed through verbatim.

\`\`\`\`
\`\`\`two-col
### Left
content...
---
### Right
content...
\`\`\`
\`\`\`\`
→ Two-column layout. Split on \`---\`.

## Table Row Class Hints

Append at end of row: \`<!-- hint -->\`

| Hint | CSS Class | Effect |
|------|-----------|--------|
| \`<!-- highlight-row -->\` | .highlight-row | Yellow highlight |
| \`<!-- phase-header -->\` | .phase-header | Blue phase divider |
| \`<!-- bucket-header -->\` | .bucket-header | Blue section header |
| \`<!-- bucket-header-pretax -->\` | .bucket-header-pretax | Amber header |
| \`<!-- bucket-header-roth -->\` | .bucket-header-roth | Green header |
| \`<!-- total -->\` | .total | Bold total with top border |

## Action Columns

Columns with "Action" in header: semicolons become line breaks; smaller font applied.

## Inline Hints

| Syntax | Result |
|--------|--------|
| \`!!warn!!text\` | Orange warning text |
| \`!!good!!text\` | Green positive text |
| \`[ROTH]\` | Green "Roth" badge |
| \`[PRETAX]\` | Amber "Pre-tax" badge |
| \`[TAXABLE]\` | Blue "Taxable" badge |
| \`[TAG:phase]text\` | Blue phase tag |
| \`[TAG:action]text\` | Amber action tag |
| \`[TAG:needed]text\` | Red needed tag |
| \`[TAG:done]text\` | Green done tag |
| \`[TAG:ok]text\` | Green ok tag |

## Directives

| Syntax | Result |
|--------|--------|
| \`<!-- pb -->\` | Page break |
| \`<!-- note: text -->\` | Small gray note |

## Table of Contents

\`## Table of Contents\` followed by a numbered list → styled two-column TOC box.
Section links use \`#sN\` matching \`## N. Title\` headings.

## Standard Markdown

\`# H1\`, \`## N. H2\` (→ id="sN"), \`### H3\`, \`**bold**\`, \`_italic_\`, \`[text](url)\`, \`---\`, \`> quote\`, pipe tables, numbered lists.
`;
