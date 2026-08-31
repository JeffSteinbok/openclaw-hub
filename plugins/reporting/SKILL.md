# Reporting Plugin — How to Use the Report System

## Overview

The `reporting` plugin provides a unified Markdown → HTML → PDF pipeline. It replaces the old `md-to-html` and `html-to-pdf` plugins.

| Tool | Purpose |
|------|---------|
| `report_render` | Assemble a multi-section report from a folder with `INDEX.json` → HTML |
| `md_to_html` | Render a single `.md` file → HTML |
| `md_to_html_syntax` | Get the full Markdown syntax reference |
| `html_to_pdf` | Convert an HTML file → PDF via Chromium |

---

## Choosing the Right Tool

**Multi-section report (folder with `INDEX.json`)** → use `report_render`
- Report is split into numbered section files
- `INDEX.json` defines `assembly_order`
- Finance retirement report (v7.90+) uses this layout

**Single `.md` file** → use `md_to_html` then `html_to_pdf`
- One file, no index
- Older report versions (v6.x, v7) use this layout

---

## Workflow 1: Multi-Section Report (`report_render`)

Used for any report folder with an `INDEX.json`.

### Step 1 — Render HTML

```
report_render(
  folder_path:      "/absolute/path/to/v7.90",
  output_html_path: "/absolute/path/to/report.html",
  template_path:    "/absolute/path/to/template.html"
)
```

Returns: `{ success, html_path, sections_assembled }`

### Step 2 — Render PDF

```
html_to_pdf(
  input_path:  "<html_path from step 1>",
  output_path: "/absolute/path/to/report.pdf"
)
```

### Rules
- **Do not read section files before calling `report_render`** — the tool reads them from disk
- Check whether HTML/PDF already exist (`fs_list`) before re-rendering
- Never use `md_to_html` on individual section files — that's not how they're intended to be used

---

## Workflow 2: Single-File Report (`md_to_html` + `html_to_pdf`)

### Step 1 — Render HTML

```
md_to_html(
  input_path:    "/absolute/path/to/report.md",
  output_path:   "/absolute/path/to/report.html",
  template_path: "/absolute/path/to/template.html"
)
```

### Step 2 — Render PDF

```
html_to_pdf(
  input_path:  "/absolute/path/to/report.html",
  output_path: "/absolute/path/to/report.pdf"
)
```

---

## INDEX.json Format

Every multi-section report folder must have an `INDEX.json`:

```json
{
  "version": "v7.90",
  "assembly_order": [
    "00-header.md",
    "01-toc.md",
    "02-whats-new.md",
    "..."
  ],
  "sections": {
    "00-header.md": "Header, KPI block",
    "..."
  },
  "change_patterns": {
    "full_math_redo": ["00-header.md", "03-cashflow.md", "..."],
    "single_section": "edit just the one file",
    "new_version": "fs_copy entire folder to vN.NN+1, then edit changed files only"
  }
}
```

- `assembly_order` — required, defines concatenation order
- `sections` — optional, human-readable section descriptions
- `change_patterns` — optional, guidance on which files to touch for common update types

---

## Editing a Single Section

1. `edit` just the one section file
2. Update `02-whats-new.md` (or equivalent change log section) to note what changed
3. Call `report_render` → `html_to_pdf`
4. Deliver with `MEDIA:<html_path>`

**Do not read other section files** — you only need the one you're changing.

## Full Math Refresh

1. Pull fresh data (e.g. `monarch_get_accounts`, `monarch_get_net_worth`)
2. Write only the affected section files (see `change_patterns.full_math_redo` in `INDEX.json`)
3. Call `report_render` → `html_to_pdf`

## New Version

1. `fs_copy` the entire version folder to the next version (e.g. `v7.90` → `v7.91`)
2. Update `INDEX.json` version field
3. Edit changed section files only
4. Call `report_render` → `html_to_pdf`

---

## Delivering Reports

Always deliver with the MEDIA directive on its own line:

```
MEDIA:/absolute/path/to/report.html
```

Then follow with a brief summary: version, what changed, PDF path.

---

## Template

The template is a plain HTML file with `<style>` blocks. The renderer extracts all CSS from it and injects it into the output. The template body is ignored — only the styles are used.

Finance retirement report template: `skills/retirement-cashflow/references/template.html` (relative to finance agent workspace).
