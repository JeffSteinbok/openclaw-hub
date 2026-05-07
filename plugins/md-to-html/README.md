# 📝 md-to-html

Converts styled Markdown reports to HTML using a CSS template file. Designed for structured reports with KPI cards, callout boxes, SVG charts, and two-column layouts.

> 💡 Pairs well with [`html-to-pdf`](../html-to-pdf/) — write Markdown, render to HTML, then generate polished PDFs, all from OpenClaw agents.

## Why this exists

LLM-generated HTML is expensive and unreliable for repeatable report formats. Each time an agent renders a report via raw HTML generation, it burns thousands of tokens re-inventing layout, styles, and structure — and the output is never consistent. This plugin lets agents write in a lightweight, extended Markdown syntax and get deterministic, pixel-consistent HTML output every time, at near-zero token cost. The agent focuses on *content*; the plugin handles *presentation*.

---

## 📑 Table of Contents

- [Tools](#tools)
- [Markdown Syntax](docs/markdown-syntax.md) — full reference for standard + extended syntax
- [Template Reference](docs/template-reference.md) — how templates work, required CSS classes, sample template
- [Testing Locally](#testing-locally)
- [Development](#development)

---

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

---

## Testing Locally

You can test your Markdown and template without running the full OpenClaw gateway:

```bash
# From the plugin directory
cd plugins/md-to-html

# Install dependencies
npm install

# Build the plugin
npm run build

# Render a test file using Node directly
node -e "
  const { createEntry } = require('./dist/index.js');
  const entry = createEntry();
  const fs = require('fs');

  // Point these at your files
  const input = '/path/to/your/report.md';
  const output = '/tmp/test-output.html';
  const template = '/path/to/your/template.html';

  const { renderMarkdown } = require('./dist/index.js');
  // Or call via the tool interface:
  entry.register({
    registerTool(name, handler, schema) {
      if (name === 'md_to_html') {
        handler({ input_path: input, output_path: output, template_path: template })
          .then(r => console.log(r));
      }
    }
  });
"

# Open the result in your browser
open /tmp/test-output.html    # macOS
xdg-open /tmp/test-output.html  # Linux
```

Or run the test suite to verify everything works:

```bash
npm test
```

---

## Development

```bash
npm install
npm test
npm run build  # outputs dist/
```
