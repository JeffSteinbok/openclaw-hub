# CLIs

Lightweight command-line tools that the OpenClaw agent can execute via `safebin`. Use a CLI when the tool is stateless, doesn't need streaming/events, and just needs to be called and return an answer.

## CLI vs Plugin

| | CLI | Plugin |
|---|---|---|
| **Use when** | Stateless call → response | Need registered tool schemas, SSE events, or gateway integration |
| **Runs as** | Subprocess via `exec` tool | Loaded into gateway process |
| **Config** | Args + env vars | `openclaw.json` pluginConfig |
| **Best for** | Simple API wrappers, shell scripts | Complex integrations with multiple tools |

## Structure

```
clis/
  <name>/
    <name>.py (or .sh, .ts, etc.)
    README.md
    tests/
```

## How to add a new CLI

1. Create `clis/<name>/<name>.py` (or whatever language)
2. Make it executable: `chmod +x clis/<name>/<name>.py`
3. Symlink to `~/safebin/`: `ln -sf $(pwd)/clis/<name>/<name>.py ~/safebin/<name>`
4. Add to safebin in `openclaw.json` (already configured to allow `~/safebin/*`)
5. Add to `TOOLS.md` so the agent knows it exists

## Naming convention

- All lowercase, no hyphens: `waitlistme` (easy to type, consistent everywhere)
- Directory matches binary name: `clis/waitlistme/waitlistme.py` → `~/safebin/waitlistme`

## Available CLIs

| CLI | Description |
|-----|-------------|
| `waitlistme` | Add yourself to a Waitlist.me queue |
