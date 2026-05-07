import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseBlocks, extractStyles, mdToHtml } from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;

const TEMPLATE = `<!DOCTYPE html>
<html>
<head>
<style>
  .kpi-row { display: flex; }
  .kpi { background: #f0f4ff; }
  .callout { background: #fff8e6; }
  .warn { color: red; }
  .roth { color: green; }
</style>
</head>
<body></body>
</html>`;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "md-to-html-test-"));
  await writeFile(join(tempDir, "template.html"), TEMPLATE);
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// extractStyles
// ---------------------------------------------------------------------------

describe("extractStyles", () => {
  it("extracts a single style block", () => {
    const css = extractStyles(TEMPLATE);
    expect(css).toContain(".kpi-row");
  });

  it("extracts multiple style blocks", () => {
    const html = "<style>a{}</style><style>b{}</style>";
    const css = extractStyles(html);
    expect(css).toContain("a{}");
    expect(css).toContain("b{}");
  });

  it("throws when no style block found", () => {
    expect(() => extractStyles("<html><body></body></html>")).toThrow("No <style> block");
  });
});

// ---------------------------------------------------------------------------
// parseBlocks — headings
// ---------------------------------------------------------------------------

describe("parseBlocks — headings", () => {
  it("parses h1", () => {
    const blocks = parseBlocks("# Title");
    expect(blocks[0]).toEqual({ type: "heading", level: 1, text: "Title", id: undefined });
  });

  it("parses h2 with section number → id", () => {
    const blocks = parseBlocks("## 3. My Section");
    expect(blocks[0]).toEqual({ type: "heading", level: 2, text: "3. My Section", id: "s3" });
  });

  it("parses h3 without id", () => {
    const blocks = parseBlocks("### Subsection");
    expect(blocks[0]).toEqual({ type: "heading", level: 3, text: "Subsection", id: undefined });
  });
});

// ---------------------------------------------------------------------------
// parseBlocks — fenced blocks
// ---------------------------------------------------------------------------

describe("parseBlocks — fenced blocks", () => {
  it("parses kpi block", () => {
    const md = "```kpi\nNet Worth | $16.7M | Monarch\nSpend | $545K | conservative\n```";
    const blocks = parseBlocks(md);
    expect(blocks[0]).toEqual({
      type: "fenced",
      tag: "kpi",
      lines: ["Net Worth | $16.7M | Monarch", "Spend | $545K | conservative"],
    });
  });

  it("parses callout-blue block", () => {
    const md = "```callout-blue\n- item one\n- item two\n```";
    const blocks = parseBlocks(md);
    expect(blocks[0]).toEqual({
      type: "fenced",
      tag: "callout-blue",
      lines: ["- item one", "- item two"],
    });
  });

  it("parses svg block", () => {
    const md = "```svg\n<svg><rect/></svg>\n```";
    const blocks = parseBlocks(md);
    expect(blocks[0]).toEqual({ type: "fenced", tag: "svg", lines: ["<svg><rect/></svg>"] });
  });
});

// ---------------------------------------------------------------------------
// parseBlocks — tables with row hints
// ---------------------------------------------------------------------------

describe("parseBlocks — tables", () => {
  it("parses a table with header", () => {
    const md = "| A | B |\n|---|---|\n| 1 | 2 |";
    const blocks = parseBlocks(md);
    const table = blocks[0] as { type: "table"; rows: string[][]; headerRow: boolean; rowHints: (string | null)[] };
    expect(table.type).toBe("table");
    expect(table.headerRow).toBe(true);
    expect(table.rows).toEqual([["A", "B"], ["1", "2"]]);
  });

  it("extracts row class hints", () => {
    const md = "| A | B |\n|---|---|\n| 1 | 2 | <!-- highlight -->\n| 3 | 4 | <!-- total -->";
    const blocks = parseBlocks(md);
    const table = blocks[0] as { type: "table"; rowHints: (string | null)[] };
    expect(table.rowHints).toEqual([null, "highlight", "total"]);
  });
});

// ---------------------------------------------------------------------------
// parseBlocks — directives
// ---------------------------------------------------------------------------

describe("parseBlocks — directives", () => {
  it("parses page break", () => {
    const blocks = parseBlocks("<!-- pb -->");
    expect(blocks[0]).toEqual({ type: "directive", kind: "pb", content: "" });
  });

  it("parses note", () => {
    const blocks = parseBlocks("<!-- note: This is a note -->");
    expect(blocks[0]).toEqual({ type: "directive", kind: "note", content: "This is a note" });
  });
});

// ---------------------------------------------------------------------------
// Full render — mdToHtml
// ---------------------------------------------------------------------------

describe("mdToHtml", () => {
  it("renders a basic document", async () => {
    const md = `# My Report
**May 2026 · v1**

---

## 1. Summary

Some paragraph text.

| Col A | Col B |
|---|---|
| val1 | val2 | <!-- highlight -->
`;
    const inputPath = join(tempDir, "basic.md");
    const outputPath = join(tempDir, "basic.html");
    await writeFile(inputPath, md);

    const result = await mdToHtml(inputPath, outputPath, join(tempDir, "template.html"));
    expect(result.success).toBe(true);

    const html = await readFile(outputPath, "utf-8");
    expect(html).toContain("<h1>My Report</h1>");
    expect(html).toContain('<h2 id="s1">');
    expect(html).toContain('<tr class="highlight">');
    expect(html).toContain("<strong>May 2026 · v1</strong>");
    expect(html).toContain(".kpi-row"); // CSS from template
  });

  it("renders KPI fenced block", async () => {
    const md = `# Report

\`\`\`kpi
Net Worth | $16.7M | Monarch 2026
Spend | $545K | conservative
\`\`\`
`;
    const inputPath = join(tempDir, "kpi.md");
    const outputPath = join(tempDir, "kpi.html");
    await writeFile(inputPath, md);

    const result = await mdToHtml(inputPath, outputPath, join(tempDir, "template.html"));
    expect(result.success).toBe(true);

    const html = await readFile(outputPath, "utf-8");
    expect(html).toContain('class="kpi-row"');
    expect(html).toContain('class="kpi-label"');
    expect(html).toContain('class="kpi-value"');
    expect(html).toContain("$16.7M");
    expect(html).toContain("Monarch 2026");
  });

  it("renders callout blocks", async () => {
    const md = `\`\`\`callout
- Warning item
\`\`\`

\`\`\`callout-good
- Positive item
\`\`\`
`;
    const inputPath = join(tempDir, "callout.md");
    const outputPath = join(tempDir, "callout.html");
    await writeFile(inputPath, md);

    const result = await mdToHtml(inputPath, outputPath, join(tempDir, "template.html"));
    expect(result.success).toBe(true);

    const html = await readFile(outputPath, "utf-8");
    expect(html).toContain('class="callout"');
    expect(html).toContain('class="callout-good"');
    expect(html).toContain("<li>Warning item</li>");
  });

  it("renders inline hints", async () => {
    const md = `# Test
!!warn!!danger ahead

[ROTH] and [PRETAX] and [TAXABLE]

[TAG:action]Do this now
`;
    const inputPath = join(tempDir, "inline.md");
    const outputPath = join(tempDir, "inline.html");
    await writeFile(inputPath, md);

    const result = await mdToHtml(inputPath, outputPath, join(tempDir, "template.html"));
    expect(result.success).toBe(true);

    const html = await readFile(outputPath, "utf-8");
    expect(html).toContain('class="warn"');
    expect(html).toContain('class="roth"');
    expect(html).toContain('class="pretax"');
    expect(html).toContain('class="taxable-tag"');
    expect(html).toContain('class="tag tag-action"');
  });

  it("renders two-col block", async () => {
    const md = `\`\`\`two-col
### Left
Some left content

---

### Right
Some right content
\`\`\`
`;
    const inputPath = join(tempDir, "twocol.md");
    const outputPath = join(tempDir, "twocol.html");
    await writeFile(inputPath, md);

    const result = await mdToHtml(inputPath, outputPath, join(tempDir, "template.html"));
    expect(result.success).toBe(true);

    const html = await readFile(outputPath, "utf-8");
    expect(html).toContain('class="two-col"');
    expect(html).toContain("Left");
    expect(html).toContain("Right");
  });

  it("passes SVG through verbatim", async () => {
    const md = `\`\`\`svg
<svg width="100" height="100"><rect fill="red"/></svg>
\`\`\`
`;
    const inputPath = join(tempDir, "svg.md");
    const outputPath = join(tempDir, "svg.html");
    await writeFile(inputPath, md);

    const result = await mdToHtml(inputPath, outputPath, join(tempDir, "template.html"));
    expect(result.success).toBe(true);

    const html = await readFile(outputPath, "utf-8");
    expect(html).toContain('<svg width="100" height="100"><rect fill="red"/></svg>');
  });

  it("renders page break and note directives", async () => {
    const md = `# Report

<!-- pb -->

<!-- note: Sources as of May 2026 -->
`;
    const inputPath = join(tempDir, "directives.md");
    const outputPath = join(tempDir, "directives.html");
    await writeFile(inputPath, md);

    const result = await mdToHtml(inputPath, outputPath, join(tempDir, "template.html"));
    expect(result.success).toBe(true);

    const html = await readFile(outputPath, "utf-8");
    expect(html).toContain('class="pb"');
    expect(html).toContain('class="note-sm"');
    expect(html).toContain("Sources as of May 2026");
  });

  it("escapes HTML in regular text", async () => {
    const md = `# Report

This has <script>alert(1)</script> in it.
`;
    const inputPath = join(tempDir, "escape.md");
    const outputPath = join(tempDir, "escape.html");
    await writeFile(inputPath, md);

    const result = await mdToHtml(inputPath, outputPath, join(tempDir, "template.html"));
    expect(result.success).toBe(true);

    const html = await readFile(outputPath, "utf-8");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("fails if output_path does not end in .html", async () => {
    const result = await mdToHtml("/tmp/x.md", "/tmp/x.txt", "/tmp/t.html");
    expect(result.success).toBe(false);
    expect(result.error).toContain(".html");
  });

  it("fails if input file not found", async () => {
    const result = await mdToHtml("/tmp/nonexistent.md", "/tmp/out.html", join(tempDir, "template.html"));
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("fails if template file not found", async () => {
    const inputPath = join(tempDir, "basic.md");
    const result = await mdToHtml(inputPath, "/tmp/out.html", "/tmp/no-template.html");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});
