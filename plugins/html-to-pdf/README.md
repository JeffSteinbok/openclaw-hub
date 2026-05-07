# HTML to PDF Plugin

Convert HTML files to PDF using Chromium headless. No configuration required.

## Requirements

Chromium must be installed and available on `PATH` as one of:
- `chromium-browser`
- `chromium`
- `google-chrome`

## Tools

| Tool | Description |
|------|-------------|
| `html_to_pdf` | Convert an HTML file to PDF |

### `html_to_pdf` parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `input_path` | string | Yes | — | Absolute path to the HTML file to render |
| `output_path` | string | Yes | — | Absolute path where the PDF should be saved (must end in `.pdf`) |
| `timeout_ms` | number | No | 30000 | Max milliseconds to wait for Chromium |

### Response

On success: `{ "success": true, "output_path": "/absolute/path/to/file.pdf" }`

On failure: `{ "success": false, "error": "..." }`

## Configuration

No configuration required.

## Development

```bash
npm run build --workspace=plugins/html-to-pdf
```
