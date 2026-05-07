# Markdown Syntax Reference

The `md-to-html` plugin supports **standard Markdown** plus a set of extensions designed for structured reports. All standard syntax works as expected — the extensions add layout primitives (KPI cards, callouts, two-column grids) and semantic hints (row classes, inline tags) without breaking compatibility with other Markdown renderers.

---

## 📑 Table of Contents

- [Standard Markdown](#standard-markdown)
- [Table of Contents Block](#table-of-contents-block)
- [Fenced Blocks](#fenced-blocks)
  - [KPI Cards](#kpi-cards)
  - [Callouts](#callouts)
  - [SVG (pass-through)](#svg-pass-through)
  - [Two-Column Layout](#two-column-layout)
- [Table Row Class Hints](#table-row-class-hints)
- [Action Columns](#action-columns)
- [Inline Text Hints](#inline-text-hints)
- [Directives](#directives)

---

## Standard Markdown

All of the following render as you'd expect from any Markdown processor:

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

---

## Table of Contents Block

A heading containing "Table of Contents" followed by an ordered list is automatically rendered as a styled two-column TOC box (`.toc` class). Links in the list items navigate to section anchors.

---

## Fenced Blocks

Standard code fences (` ``` `) with a tag name trigger special rendering instead of `<pre><code>`.

### KPI Cards

````md
```kpi
Revenue | $2.4M | Q1 2026
Growth | +12% | year-over-year
Margin | 34% | target: 30%
```
````

Each line: `label | value | sub-label`. Renders as `.kpi-row` with `.kpi` cards.

### Callouts

````md
```callout
**Warning title**
- First concern
- Second concern
```

```callout-blue
**Info title**
- Helpful context
```

```callout-good
**Success title**
- Positive outcome
```
````

Renders as styled boxes (`.callout`, `.callout-blue`, `.callout-good`). Lines starting with `-` become `<ul><li>`; other lines become `<p>`.

| Tag | Color | Use for |
|-----|-------|---------|
| `callout` | Yellow | Warnings, decisions needed |
| `callout-blue` | Blue | Info, tips, notes |
| `callout-good` | Green | Positive outcomes, confirmations |

### SVG (pass-through)

````md
```svg
<svg width="100%" viewBox="0 0 900 300">...</svg>
```
````

SVG content is emitted verbatim (no escaping). Use for inline charts and diagrams.

### Two-Column Layout

````md
```two-col
### Left heading
Content for left column...

---

### Right heading
Content for right column...
```
````

Split on `---`; each half parsed as normal Markdown, wrapped in `.two-col > div`.

---

## Table Row Class Hints

Append an HTML comment at the end of any table row to apply a CSS class:

```md
| Year | Amount |<!-- highlight-row -->
| **Phase 1: Setup** | |<!-- phase-header -->
| **Total** | $14M |<!-- total-row -->
```

| Hint | CSS Class | Effect |
|------|-----------|--------|
| `<!-- highlight-row -->` | `.highlight-row` | Yellow highlight |
| `<!-- phase-header -->` | `.phase-header` | Full-colspan row, ALL CAPS, section divider |
| `<!-- total-row -->` | `.total-row` | Grey background, bold, border-top |
| `<!-- bucket-header -->` | `.bucket-header` | Bucket section header |

Phase-header rows span all columns with `colspan` and render text in uppercase — use them to divide a single table into visual sections while keeping columns aligned.

---

## Action Columns

Table columns with "Action" in the header automatically:
- Get the `.action-q` CSS class (smaller font)
- Convert semicolons (`;`) to `<br>` line breaks

This is useful for multi-step action items in a single cell.

---

## Inline Text Hints

| Syntax | Output |
|--------|--------|
| `!!warn!!text` | `<span class="warn">text</span>` |
| `!!good!!text` | `<span class="good">text</span>` |
| `[TAG:phase]text` | `<span class="tag tag-phase">text</span>` |
| `[TAG:action]text` | `<span class="tag tag-action">text</span>` |
| `[TAG:needed]text` | `<span class="tag tag-needed">text</span>` |
| `[TAG:done]text` | `<span class="tag tag-done">text</span>` |
| `[TAG:ok]text` | `<span class="tag tag-ok">text</span>` |

Tags render as small colored badges. Define styles for each tag class in your template.

---

## Directives

| Syntax | Output |
|--------|--------|
| `<!-- pb -->` | `<div class="pb"></div>` (page break for PDF) |
| `<!-- note: text -->` | `<p class="note-sm">text</p>` |
