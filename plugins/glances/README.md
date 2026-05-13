# Glances

Read live system metrics from a Glances server. This plugin focuses on the common operator questions: CPU load, memory usage, disk usage, and a compact overall summary.

## Tools

| Tool | Description |
|------|-------------|
| [`glances_summary_get`](#tool-glances_summary_get) | Get a compact summary with CPU, memory, uptime, and one filesystem |
| [`glances_cpu_get`](#tool-glances_cpu_get) | Get current CPU metrics, optionally including per-core usage |
| [`glances_memory_get`](#tool-glances_memory_get) | Get current memory usage metrics |
| [`glances_disk_get`](#tool-glances_disk_get) | Get filesystem usage metrics for one mount point |
| [`glances_endpoint_get`](#tool-glances_endpoint_get) | Fetch a raw JSON payload from a specific `/api/3/` endpoint |

## Configuration Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Optional | Base URL for the Glances web server |

## Example config

Set Glances under `plugins.entries["glances"].config`:

```json
{
  "plugins": {
    "entries": {
      "glances": {
        "enabled": true,
        "config": {
          "url": "http://127.0.0.1:61208"
        }
      }
    }
  }
}
```

If omitted, the plugin defaults to `http://127.0.0.1:61208`.

## Tool Parameters

<a id="tool-glances_summary_get"></a>

### `glances_summary_get`

- `mount_point` — optional filesystem mount point to summarize (default `/`)

<a id="tool-glances_cpu_get"></a>

### `glances_cpu_get`

- `include_percpu` — optional flag to include per-core CPU usage

<a id="tool-glances_memory_get"></a>

### `glances_memory_get`

- No parameters

<a id="tool-glances_disk_get"></a>

### `glances_disk_get`

- `mount_point` — optional filesystem mount point to query (default `/`)

<a id="tool-glances_endpoint_get"></a>

### `glances_endpoint_get`

- `path` — required Glances API path beginning with `/api/3/`

## Notes

- The plugin targets Glances v3 REST endpoints.
- Disk summaries default to the `/` mount point unless you pass a different `mount_point`.
- `glances_endpoint_get` is intentionally limited to `/api/3/` paths.

## Development

### Build

```bash
npm run build --workspace=plugins/glances
```

### Test

```bash
python3 plugins/glances/tests/test_tools.py
```

---

## CLI Usage

Built with [Carapace Plugin SDK](https://github.com/JeffSteinbok/carapace-plugin-sdk).

All tools are also available as a standalone CLI:

```bash
cd plugins/glances
npm install && npm run build
node dist/bin/glances.js --help
```

### Example commands

```bash
node dist/bin/glances.js glances-summary-get ...
node dist/bin/glances.js glances-cpu-get ...
node dist/bin/glances.js glances-memory-get ...
node dist/bin/glances.js glances-disk-get ...
node dist/bin/glances.js glances-endpoint-get ...

# JSON output
node dist/bin/glances.js <command> [args...] --json
```

### CLI Environment Variables

| Variable | Description |
|----------|-------------|
| `GLANCES_URL` | Base URL for the Glances web server, e.g. http://127.0.0.1:61208 |
