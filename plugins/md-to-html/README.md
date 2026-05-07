# md-to-html

Converts styled Markdown reports to HTML using a CSS template file. Designed for structured reports with KPI cards, callout boxes, SVG charts, and two-column layouts.

## Tools

### `md_to_html`

Renders a Markdown file to HTML using a CSS template.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `input_path` | Yes | Absolute path to the Markdown file |
| `output_path` | Yes | Absolute path for the HTML output (must end in `.html`) |
| `template_path` | Yes | Absolute path to an HTML template containing `<style>` blocks |

Returns `{ success: true, output_path }` or `{ success: false, error }`.

### `md_to_html_syntax`

Returns the complete Markdown syntax reference as a string. No parameters. Use this to learn the supported syntax without needing file access.

## Markdown Syntax

### Standard Markdown

| Syntax | Output |
|--------|--------|
| `# Title` | `<h1>` |
| `## N. Section` | `<h2 id="sN">` (section number extracted for TOC links) |
| `### Subsection` | `<h3>` |
| `**bold**` | `<strong>` |
| `_italic_` | `<em>` |
| `[text](url)` | `<a href="url">text</a>` |
| `---` | `<hr>` |
| `> text` | `<blockquote>` (supports `- ` bullets inside) |
| Pipe tables | `<table>` with `<thead>`/`<tbody>` |
| `1. item` | `<ol><li>` |
| `<small>text</small>` | Raw HTML pass-through (also `<div>`, `<aside>`, `<figcaption>`) |

### Table of Contents

A heading containing "Table of Contents" followed by an ordered list is automatically rendered as a styled two-column TOC box (`.toc` class).

### Fenced Blocks

#### KPI Cards

````md
```kpi
Net Worth | $16.7M | Monarch 2026-05-06
Spending | $545K/yr | conservative
```
````

Each line: `label | value | sub-label`. Renders as `.kpi-row` with `.kpi` cards.

#### Callouts

````md
```callout
**Title line** (rendered as <p>)
- Warning bullet 1
- Warning bullet 2
```

```callout-blue
**Info title**
- Info bullet
```

```callout-good
**Success title**
- Positive bullet
```
````

Renders as styled boxes (`.callout`, `.callout-blue`, `.callout-good`). Lines starting with `-` become `<ul><li>`; other lines become `<p>`. Use:
- `callout` (yellow) — warnings, decisions needed
- `callout-blue` (blue) — info, tips, notes
- `callout-good` (green) — positive outcomes, confirmations

#### SVG (pass-through)

````md
```svg
<svg width="100%" viewBox="0 0 900 300">...</svg>
```
````

SVG content is emitted verbatim (no escaping).

#### Two-Column Layout

````md
```two-col
### Left heading
Content...

---

### Right heading
Content...
```
````

Split on `---`; each half parsed as normal Markdown, wrapped in `.two-col > div`.

### Table Row Class Hints

Append an HTML comment at the end of any table row to apply a CSS class:

```md
| Year | Amount | <!-- highlight-row -->
| **Phase 1: Bridge** | | <!-- phase-header -->
| **Total** | $14M | <!-- total-row -->
```

| Hint | CSS Class | Effect |
|------|-----------|--------|
| `<!-- highlight-row -->` | `.highlight-row` | Yellow highlight |
| `<!-- phase-header -->` | `.phase-header` | Full-colspan row, ALL CAPS, section divider |
| `<!-- total-row -->` | `.total-row` | Grey background, bold, border-top |
| `<!-- bucket-header -->` | `.bucket-header` | Bucket section header |
| `<!-- bucket-header-pretax -->` | `.bucket-header-pretax` | Pre-tax bucket header |
| `<!-- bucket-header-roth -->` | `.bucket-header-roth` | Roth bucket header |

Phase-header rows span all columns with `colspan` and render text in uppercase — use them to divide a single table into visual sections while keeping columns aligned.

### Action Columns

Table columns with "Action" in the header automatically:
- Get the `.action-q` CSS class (smaller font)
- Convert semicolons (`;`) to `<br>` line breaks

### Inline Text Hints

| Syntax | Output |
|--------|--------|
| `!!warn!!text` | `<span class="warn">text</span>` |
| `!!good!!text` | `<span class="good">text</span>` |
| `[ROTH]` | `<span class="roth">Roth</span>` |
| `[PRETAX]` | `<span class="pretax">Pre-tax</span>` |
| `[TAXABLE]` | `<span class="taxable-tag">Taxable</span>` |
| `[TAG:phase]text` | `<span class="tag tag-phase">text</span>` |
| `[TAG:action]text` | `<span class="tag tag-action">text</span>` |
| `[TAG:needed]text` | `<span class="tag tag-needed">text</span>` |
| `[TAG:done]text` | `<span class="tag tag-done">text</span>` |
| `[TAG:ok]text` | `<span class="tag tag-ok">text</span>` |

### Directives

| Syntax | Output |
|--------|--------|
| `<!-- pb -->` | `<div class="pb"></div>` (page break) |
| `<!-- note: text -->` | `<p class="note-sm">text</p>` |

## Template

The template file is a standard HTML file. Only the `<style>` blocks are extracted — the rest is ignored. The renderer generates a complete HTML document using those styles.

## Development

```bash
npm install
npm test
npm run build # outputs dist/
```
