# Template Reference

The `md_to_html` tool requires a **template file** — a standard HTML file whose `<style>` blocks define the look and feel of the rendered output. Only the CSS is extracted; the rest of the template HTML is ignored.

---

## How it works

1. The renderer reads your template file
2. All `<style>...</style>` blocks are extracted and concatenated
3. A complete HTML document is generated with those styles injected into the `<head>`
4. Your Markdown content is rendered into the `<body>`

This means your template is purely a CSS delivery mechanism — you control typography, colors, spacing, and layout entirely through styles.

---

## Required CSS classes

The renderer emits specific class names. Your template should define styles for at least these:

### Layout

| Class | Used by |
|-------|---------|
| `.kpi-row` | Container for KPI cards row |
| `.kpi` | Individual KPI card |
| `.kpi .value` | The main metric value |
| `.kpi .sub` | Sub-label below value |
| `.two-col` | Two-column grid container |
| `.toc` | Table of contents box |

### Callouts

| Class | Used by |
|-------|---------|
| `.callout` | Yellow warning callout |
| `.callout-blue` | Blue info callout |
| `.callout-good` | Green success callout |

### Table hints

| Class | Used by |
|-------|---------|
| `.highlight-row` | Highlighted table row |
| `.phase-header` | Section divider row (full colspan, uppercase) |
| `.total-row` | Summary/total row |
| `.bucket-header` | Bucket section header |
| `.action-q` | Action column cells (smaller font) |

### Inline hints

| Class | Used by |
|-------|---------|
| `.warn` | Warning-colored inline text |
| `.good` | Success-colored inline text |
| `.tag` | Base tag badge style |
| `.tag-phase` | Phase tag variant |
| `.tag-action` | Action tag variant |
| `.tag-needed` | Needed/pending tag |
| `.tag-done` | Completed tag |
| `.tag-ok` | OK/passing tag |

### Utilities

| Class | Used by |
|-------|---------|
| `.pb` | Page break (for PDF rendering) |
| `.note-sm` | Small footnote text |

---

## Sample template

```html
<!DOCTYPE html>
<html>
<head>
<style>
/* === Base === */
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.6;
  color: #1a1a1a;
  max-width: 900px;
  margin: 0 auto;
  padding: 2rem;
}

h1 { font-size: 1.8rem; border-bottom: 2px solid #333; padding-bottom: 0.3rem; }
h2 { font-size: 1.4rem; margin-top: 2rem; color: #2c3e50; }
h3 { font-size: 1.1rem; color: #34495e; }

/* === Tables === */
table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
th, td { border: 1px solid #ddd; padding: 0.5rem 0.75rem; text-align: left; }
th { background: #f5f5f5; font-weight: 600; }
tr:nth-child(even) { background: #fafafa; }

.highlight-row { background: #fff3cd !important; }
.total-row { background: #e9ecef !important; font-weight: 700; border-top: 2px solid #333; }
.phase-header td { background: #2c3e50; color: #fff; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em; }
.bucket-header td { background: #eef2f7; font-weight: 600; }
.action-q { font-size: 0.85em; }

/* === KPI Cards === */
.kpi-row { display: flex; gap: 1rem; margin: 1.5rem 0; flex-wrap: wrap; }
.kpi {
  flex: 1;
  min-width: 160px;
  background: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  padding: 1rem;
  text-align: center;
}
.kpi .value { font-size: 1.6rem; font-weight: 700; color: #2c3e50; }
.kpi .sub { font-size: 0.8rem; color: #6c757d; margin-top: 0.25rem; }

/* === Callouts === */
.callout, .callout-blue, .callout-good {
  border-left: 4px solid;
  border-radius: 4px;
  padding: 1rem 1.25rem;
  margin: 1rem 0;
}
.callout { background: #fff8e1; border-color: #f9a825; }
.callout-blue { background: #e3f2fd; border-color: #1976d2; }
.callout-good { background: #e8f5e9; border-color: #388e3c; }

/* === Two-Column === */
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin: 1.5rem 0; }

/* === TOC === */
.toc {
  background: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  padding: 1.5rem;
  columns: 2;
  column-gap: 2rem;
}
.toc ol { margin: 0; padding-left: 1.25rem; }
.toc li { margin-bottom: 0.3rem; }

/* === Inline Hints === */
.warn { color: #d32f2f; font-weight: 600; }
.good { color: #2e7d32; font-weight: 600; }
.tag {
  display: inline-block;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.1rem 0.5rem;
  border-radius: 3px;
  text-transform: uppercase;
}
.tag-phase { background: #e3f2fd; color: #1565c0; }
.tag-action { background: #fff3e0; color: #e65100; }
.tag-needed { background: #fce4ec; color: #c62828; }
.tag-done { background: #e8f5e9; color: #2e7d32; }
.tag-ok { background: #e8f5e9; color: #2e7d32; }

/* === Utilities === */
.pb { page-break-after: always; }
.note-sm { font-size: 0.8rem; color: #6c757d; font-style: italic; }
hr { border: none; border-top: 1px solid #dee2e6; margin: 2rem 0; }
blockquote { border-left: 3px solid #dee2e6; margin: 1rem 0; padding: 0.5rem 1rem; color: #555; }
</style>
</head>
<body></body>
</html>
```

Save this as your starting template and customize the styles to match your brand/preferences. The renderer only extracts the `<style>` content — the `<body>` is unused.
