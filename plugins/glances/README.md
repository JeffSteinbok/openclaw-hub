# Glances

Read live system metrics from a Glances server. This plugin focuses on the common operator questions: CPU load, memory usage, disk usage, and a compact overall summary.

## Tools

| Tool | Description |
|------|-------------|
| `glances_summary_get` | Get a compact summary with CPU, memory, uptime, and one filesystem |
| `glances_cpu_get` | Get current CPU metrics, optionally including per-core usage |
| `glances_memory_get` | Get current memory usage metrics |
| `glances_disk_get` | Get filesystem usage metrics for one mount point |
| `glances_endpoint_get` | Fetch a raw JSON payload from a specific `/api/3/` endpoint |

## Configuration

The plugin uses a configurable Glances base URL:

| Field | Description |
|-------|-------------|
| `url` | Base URL for the Glances web server, e.g. `http://127.0.0.1:61208` |

If omitted, the plugin defaults to `http://127.0.0.1:61208`.

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
