#!/usr/bin/env python3
"""Build a docs-satellite bundle for public plugin, service, and shared-lib pages."""

from __future__ import annotations

import ast
import datetime
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PLUGINS_DIR = REPO_ROOT / "plugins"
SERVICES_DIR = REPO_ROOT / "services"
LIBS_DIR = REPO_ROOT / "libs" / "ts"
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


def _load_release_services() -> list[str]:
    manifest = _load_json(RELEASE_MANIFEST_PATH)
    includes = manifest.get("includes") or {}
    services = includes.get("services") or []
    return [service_id for service_id in services if isinstance(service_id, str)]


def _load_release_shared_libs() -> list[str]:
    """Discover TS libs that have a package.json."""
    if not LIBS_DIR.exists():
        return []
    return sorted(
        d.name for d in LIBS_DIR.iterdir()
        if d.is_dir() and (d / "package.json").exists()
    )


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


def _extract_sections(lines: list[str]) -> dict[str, str]:
    sections: dict[str, str] = {}
    current_heading = ""
    current_lines: list[str] = []
    for line in lines:
        if line.startswith("## "):
            if current_heading:
                sections[current_heading] = "\n".join(current_lines).strip()
            current_heading = line[3:].strip()
            current_lines = []
        elif current_heading:
            current_lines.append(line.rstrip())
    if current_heading:
        sections[current_heading] = "\n".join(current_lines).strip()
    return sections


def _extract_bullet_section(lines: list[str], heading: str) -> list[str]:
    items: list[str] = []
    in_section = False
    for line in lines:
        stripped = line.strip()
        if stripped == f"## {heading}" or stripped == f"### {heading}":
            in_section = True
            continue
        if in_section:
            if stripped.startswith("#"):
                break
            if stripped.startswith("- "):
                items.append(stripped[2:].strip())
    return items


def _extract_env_table(lines: list[str]) -> list[dict]:
    env_vars: list[dict] = []
    in_table = False
    header_seen = False
    headers: list[str] = []
    for line in lines:
        stripped = line.strip()
        if "Variable" in stripped and "Description" in stripped and "|" in stripped:
            in_table = True
            header_seen = False
            headers = [col.strip().lower() for col in stripped.split("|")[1:-1]]
            continue
        if in_table:
            if stripped.startswith("|") and set(stripped.replace("|", "").strip()) <= {"-", " ", ":"}:
                header_seen = True
                continue
            if header_seen and stripped.startswith("|"):
                cols = [c.strip().strip("`") for c in stripped.split("|")[1:-1]]
                if "variable" not in headers or "description" not in headers:
                    continue
                name_index = headers.index("variable")
                description_index = headers.index("description")
                if max(name_index, description_index) >= len(cols):
                    continue
                entry = {
                    "name": cols[name_index],
                    "description": cols[description_index],
                }
                if "required" in headers:
                    required_index = headers.index("required")
                    if required_index < len(cols):
                        entry["required"] = cols[required_index].lower().startswith("yes")
                env_vars.append(entry)
            elif not stripped.startswith("|"):
                in_table = False
    return env_vars


def _declared_env_var_names(manifest: dict) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()

    def add(raw_names: object) -> None:
        if not isinstance(raw_names, list):
            return
        for raw_name in raw_names:
            if not isinstance(raw_name, str):
                continue
            name = raw_name.strip()
            if not name or name in seen:
                continue
            seen.add(name)
            names.append(name)

    setup = manifest.get("setup")
    if isinstance(setup, dict):
        providers = setup.get("providers")
        if isinstance(providers, list):
            for provider in providers:
                if isinstance(provider, dict):
                    add(provider.get("envVars"))

    provider_auth_env_vars = manifest.get("providerAuthEnvVars")
    if isinstance(provider_auth_env_vars, dict):
        for raw_names in provider_auth_env_vars.values():
            add(raw_names)

    channel_env_vars = manifest.get("channelEnvVars")
    if isinstance(channel_env_vars, dict):
        for raw_names in channel_env_vars.values():
            add(raw_names)

    return names


def _declared_env_vars(manifest: dict, plugin_dir: Path) -> list[dict]:
    declared_names = _declared_env_var_names(manifest)
    if not declared_names:
        return []

    readme_path = plugin_dir / "README.md"
    if not readme_path.exists():
        raise ValueError(f"Plugin {plugin_dir.name} declares env vars but is missing README.md")

    readme_env_vars = _extract_env_table(readme_path.read_text(encoding="utf-8").splitlines())
    env_by_name = {
        entry.get("name"): entry
        for entry in readme_env_vars
        if isinstance(entry, dict) and isinstance(entry.get("name"), str)
    }
    missing = [name for name in declared_names if name not in env_by_name]
    if missing:
        missing_str = ", ".join(missing)
        raise ValueError(
            f"Plugin {plugin_dir.name} declares env vars missing from README.md Environment Variables table: {missing_str}"
        )

    env_vars: list[dict] = []
    for name in declared_names:
        readme_entry = env_by_name[name]
        env_entry = {
            "name": name,
            "description": readme_entry.get("description", ""),
        }
        if "required" in readme_entry:
            env_entry["required"] = bool(readme_entry["required"])
        env_vars.append(env_entry)
    return env_vars


def _parse_markdown(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    title = ""
    desc_start = 0
    for idx, line in enumerate(lines):
        stripped = line.strip().lstrip("#").strip()
        if stripped:
            title = stripped
            desc_start = idx + 1
            break

    desc_lines: list[str] = []
    for line in lines[desc_start:]:
        stripped = line.strip()
        if not stripped:
            if desc_lines:
                break
            continue
        desc_lines.append(stripped)

    return {
        "name": title,
        "summary": " ".join(desc_lines),
        "sections": _extract_sections(lines),
        "lines": lines,
        "content": text.strip(),
    }


def summarise_plugin(plugin_id: str) -> dict:
    plugin_dir = PLUGINS_DIR / plugin_id
    manifest = _load_json(plugin_dir / "openclaw.plugin.json")
    raw_tools = _call_manifest(plugin_dir)
    env_vars = _declared_env_vars(manifest, plugin_dir)
    parsed_readme = _parse_markdown(plugin_dir / "README.md") if (plugin_dir / "README.md").exists() else {"sections": {}}
    sections = parsed_readme.get("sections", {})
    configuration = sections.get("Example config", sections.get("Configuration", ""))

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
        "configuration": configuration,
        "config_schema": manifest.get("configSchema", {}),
        "env_vars": env_vars,
        "tools": tools,
        "public_types": [],
        "examples": [],
        "limitations": [],
        "source_url": f"https://github.com/JeffSteinbok/openclaw-hub/tree/main/plugins/{plugin_id}",
        "origin": "openclaw-hub",
    }


def summarise_service(service_id: str) -> dict:
    service_dir = SERVICES_DIR / service_id
    parsed = _parse_markdown(service_dir / "README.md")
    lines = parsed["lines"]
    return {
        "service": service_id,
        "name": parsed["name"] or service_id,
        "summary": parsed["summary"],
        "features": _extract_bullet_section(lines, "Features"),
        "env_vars": _extract_env_table(lines),
        "sections": parsed["sections"],
        "source_url": f"https://github.com/JeffSteinbok/openclaw-hub/tree/main/services/{service_id}",
        "docs_url": f"/services/{service_id}",
        "origin": "openclaw-hub",
    }


def _summarise_library(library_id: str) -> dict:
    lib_dir = LIBS_DIR / library_id
    parsed = _parse_markdown(lib_dir / "README.md") if (lib_dir / "README.md").exists() else None
    src_dir = lib_dir / "src"
    ts_files = sorted(
        path for path in src_dir.glob("*.ts") if path.name != "index.ts"
    ) if src_dir.exists() else []
    return {
        "library": library_id,
        "language": "typescript",
        "name": (parsed or {}).get("name") or library_id,
        "summary": (parsed or {}).get("summary") or "",
        "modules": [
            {
                "name": path.stem,
                "path": f"libs/ts/{library_id}/src/{path.name}",
            }
            for path in ts_files
        ],
        "paths": {
            "package": f"libs/ts/{library_id}",
            "entry": f"libs/ts/{library_id}/src/index.ts",
        },
        "readme": f"libs/ts/{library_id}/README.md" if (lib_dir / "README.md").exists() else None,
        "sections": (parsed or {}).get("sections", {}),
        "content": (parsed or {}).get("content", ""),
        "source_url": f"https://github.com/JeffSteinbok/openclaw-hub/tree/main/libs/ts/{library_id}",
        "docs_url": f"/libs/{library_id}",
        "origin": "openclaw-hub",
    }


def summarise_shared_libs() -> tuple[dict, list[dict]]:
    parsed = _parse_markdown(LIBS_DIR / "README.md") if (LIBS_DIR / "README.md").exists() else {
        "name": "Shared TypeScript libs",
        "summary": "",
        "sections": {},
    }
    libraries: list[dict] = []
    for library_id in _load_release_shared_libs():
        detail = _summarise_library(library_id)
        libraries.append(
            {
                "id": detail["library"],
                "name": detail["name"],
                "description": detail["summary"],
                "language": detail["language"],
            }
        )
    index = {
        "group": "shared-ts-libs",
        "name": parsed["name"] or "Shared TypeScript libs",
        "summary": parsed["summary"],
        "language": "typescript",
        "dependency_rules": _extract_bullet_section(parsed.get("lines", []), "Dependency direction"),
        "sections": parsed["sections"],
        "libraries": libraries,
        "source_url": "https://github.com/JeffSteinbok/openclaw-hub/tree/main/libs/ts",
        "origin": "openclaw-hub",
    }
    return index, [_summarise_library(library["id"]) for library in libraries]


def build_docs_satellite(out_dir: Path = OUT_DIR) -> dict:
    plugins_dir = out_dir / "plugins"
    services_dir = out_dir / "services"
    libs_dir = out_dir / "libs"
    plugins_dir.mkdir(parents=True, exist_ok=True)
    services_dir.mkdir(parents=True, exist_ok=True)
    libs_dir.mkdir(parents=True, exist_ok=True)
    artifacts: list[str] = []

    for plugin_id in _load_release_plugins():
        summary = summarise_plugin(plugin_id)
        out_path = plugins_dir / f"{plugin_id}.json"
        out_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
        artifacts.append(str(out_path.relative_to(out_dir)))

    services_index: list[dict] = []
    for service_id in _load_release_services():
        summary = summarise_service(service_id)
        services_index.append(
            {
                "id": service_id,
                "name": summary["name"],
                "description": summary["summary"],
            }
        )
        out_path = services_dir / f"{service_id}.json"
        out_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
        artifacts.append(str(out_path.relative_to(out_dir)))

    services_index_path = out_dir / "services.json"
    services_index_path.write_text(json.dumps({"services": services_index}, indent=2) + "\n", encoding="utf-8")
    artifacts.append(str(services_index_path.relative_to(out_dir)))

    libs_index, libs_details = summarise_shared_libs()
    libs_index_path = out_dir / "libs.json"
    libs_index_path.write_text(json.dumps(libs_index, indent=2) + "\n", encoding="utf-8")
    artifacts.append(str(libs_index_path.relative_to(out_dir)))
    for detail in libs_details:
        out_path = libs_dir / f"{detail['library']}.json"
        out_path.write_text(json.dumps(detail, indent=2) + "\n", encoding="utf-8")
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
    print(f"Built docs satellite bundle with {len(manifest['artifacts'])} artifact(s).", file=sys.stderr)


if __name__ == "__main__":
    main()
