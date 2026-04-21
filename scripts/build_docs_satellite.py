#!/usr/bin/env python3
"""Build a docs-satellite bundle for public plugin detail pages."""

from __future__ import annotations

import ast
import datetime
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PLUGINS_DIR = REPO_ROOT / "plugins"
RELEASE_MANIFEST_PATH = REPO_ROOT / "release-manifest.json"
OUT_DIR = REPO_ROOT / "out" / "docs-satellite"


def _load_json(path: Path) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _load_release_plugins() -> list[str]:
    manifest = _load_json(RELEASE_MANIFEST_PATH)
    includes = manifest.get("includes") or {}
    plugins = includes.get("plugins") or []
    return [plugin_id for plugin_id in plugins if isinstance(plugin_id, str)]


def _parse_tools_static(plugin_dir: Path) -> list[dict]:
    tools_py = plugin_dir / "src" / "tools.py"
    if not tools_py.exists():
        return []
    try:
        tree = ast.parse(tools_py.read_text(encoding="utf-8"))
    except Exception:
        return []

    for node in ast.iter_child_nodes(tree):
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id == "TOOLS":
                return _extract_tools_from_dict(node.value)
    return []


def _extract_tools_from_dict(node: ast.expr) -> list[dict]:
    if not isinstance(node, ast.Dict):
        return []

    tools: list[dict] = []
    for key, value in zip(node.keys, node.values):
        if key is None or not isinstance(value, ast.Dict):
            continue
        try:
            name = ast.literal_eval(key)
        except (TypeError, ValueError):
            continue
        tool_dict = _safe_literal_eval_dict(value)
        if tool_dict is None:
            continue
        tool_entry: dict = {"name": name}
        if "description" in tool_dict:
            tool_entry["description"] = tool_dict["description"]
        if "input_schema" in tool_dict:
            tool_entry["input_schema"] = tool_dict["input_schema"]
        elif "inputSchema" in tool_dict:
            tool_entry["input_schema"] = tool_dict["inputSchema"]
        tools.append(tool_entry)
    return tools


def _safe_literal_eval_dict(node: ast.expr) -> dict | None:
    if not isinstance(node, ast.Dict):
        return None
    result = {}
    for key, value in zip(node.keys, node.values):
        if key is None:
            continue
        try:
            parsed_key = ast.literal_eval(key)
        except (TypeError, ValueError):
            continue
        try:
            result[parsed_key] = ast.literal_eval(value)
        except (TypeError, ValueError):
            continue
    return result


def _call_manifest(plugin_dir: Path) -> list[dict]:
    tools = _parse_tools_static(plugin_dir)
    if tools:
        return tools

    tools_py = plugin_dir / "src" / "tools.py"
    if not tools_py.exists():
        return []
    try:
        result = subprocess.run(
            [sys.executable, str(tools_py)],
            input='{"method":"manifest"}',
            capture_output=True,
            text=True,
            timeout=15,
            cwd=str(plugin_dir),
        )
        if result.returncode != 0:
            return []
        payload = json.loads(result.stdout)
        tools = payload.get("tools")
        return tools if isinstance(tools, list) else []
    except Exception:
        return []


def _normalise_parameters(schema: dict | None) -> dict[str, dict]:
    if not isinstance(schema, dict):
        return {}
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        return {}
    required_names = schema.get("required")
    required = set(required_names if isinstance(required_names, list) else [])

    ordered_names = [name for name in properties if name in required]
    ordered_names.extend(name for name in properties if name not in required)

    parameters: dict[str, dict] = {}
    for name in ordered_names:
        raw_meta = properties.get(name)
        meta = raw_meta if isinstance(raw_meta, dict) else {}
        entry = {
            "type": meta.get("type", "string"),
            "required": name in required,
            "description": meta.get("description", ""),
        }
        if "enum" in meta:
            entry["enum"] = meta["enum"]
        if "default" in meta:
            entry["default"] = meta["default"]
        parameters[name] = entry
    return parameters


def summarise_plugin(plugin_id: str) -> dict:
    plugin_dir = PLUGINS_DIR / plugin_id
    manifest = _load_json(plugin_dir / "openclaw.plugin.json")
    raw_tools = _call_manifest(plugin_dir)

    tools = []
    for tool in raw_tools:
        tool_entry = {
            "name": tool.get("name", ""),
            "description": tool.get("description", ""),
        }
        parameters = _normalise_parameters(tool.get("input_schema", tool.get("inputSchema", {})))
        if parameters:
            tool_entry["parameters"] = parameters
        tools.append(tool_entry)

    return {
        "plugin": plugin_id,
        "name": manifest.get("name", plugin_id),
        "summary": manifest.get("description", ""),
        "tools": tools,
        "public_types": [],
        "examples": [],
        "limitations": [],
        "source_url": f"https://github.com/JeffSteinbok/openclaw-hub/tree/main/plugins/{plugin_id}",
        "origin": "openclaw-hub",
    }


def build_docs_satellite(out_dir: Path = OUT_DIR) -> dict:
    plugins_dir = out_dir / "plugins"
    plugins_dir.mkdir(parents=True, exist_ok=True)
    artifacts: list[str] = []

    for plugin_id in _load_release_plugins():
        summary = summarise_plugin(plugin_id)
        out_path = plugins_dir / f"{plugin_id}.json"
        out_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
        artifacts.append(str(out_path.relative_to(out_dir)))

    manifest = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
        "bundle_version": 1,
        "artifacts": sorted(artifacts),
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def main() -> None:
    if OUT_DIR.exists():
        for path in sorted(OUT_DIR.rglob("*.json")):
            path.unlink()
    manifest = build_docs_satellite()
    print(f"Built docs satellite bundle with {len(manifest['artifacts'])} plugin chunk(s).", file=sys.stderr)


if __name__ == "__main__":
    main()
