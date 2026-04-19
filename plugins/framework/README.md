# OpenClaw Python Plugin Framework

Shared TypeScript-to-Python bridge for OpenClaw plugins. It lets a plugin keep its business logic in Python while still registering native-looking tools through the standard TypeScript plugin API.

## How It Works

```
OpenClaw Agent → Plugin (index.ts) → createPythonPlugin → Python (tools.py)
```

1. `createPythonPlugin` spawns `python3 tools.py` with `{"method": "manifest"}` on stdin
2. Python returns a list of tools (name, description, input schema)
3. Each tool is registered with the OpenClaw agent
4. On tool call, spawns Python again with `{"method": "call", "tool": "name", "args": {...}}`
5. Python handler runs, returns JSON result on stdout

## Usage

In your plugin's `src/index.ts`:

```typescript
import { createPythonPlugin } from "@local/openclaw-python-framework";

export default function register(api: any) {
  createPythonPlugin(api, { script: new URL("./tools.py", import.meta.url) });
}
```

In your plugin's `src/tools.py`:

```python
import json, sys

TOOLS = {
    "my_tool": {
        "description": "What this tool does",
        "input_schema": { "type": "object", "properties": { ... }, "required": [...] },
        "handler": my_handler_function
    }
}

def manifest():
    return {"tools": [{"name": k, "description": v["description"], "input_schema": v["input_schema"]} for k, v in TOOLS.items()]}

def call(tool, args):
    return TOOLS[tool]["handler"](args)

def main():
    payload = json.load(sys.stdin)
    if payload["method"] == "manifest":
        print(json.dumps(manifest()))
    elif payload["method"] == "call":
        print(json.dumps(call(payload["tool"], payload["args"])))

if __name__ == "__main__":
    main()
```

## Plugin Structure

Each plugin using this framework has:

```
my-plugin/
├── openclaw.plugin.json    # Plugin metadata
├── package.json            # Depends on @local/openclaw-python-framework
├── tsconfig.json
├── src/
│   ├── index.ts            # 3-line loader
│   └── tools.py            # Python tool definitions + handlers
├── requirements.txt        # Python deps (if any)
└── README.md
```

## API

### `createPythonPlugin(api, options)`

- `api` — OpenClaw plugin API (provides `registerTool`)
- `options.script` — `URL` pointing to the Python tools.py file
