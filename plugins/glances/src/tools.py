#!/usr/bin/env python3
"""OpenClaw plugin tools wrapper for the Glances REST API."""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


GLANCES_BASE_URL = os.environ.get("GLANCES_BASE_URL", "http://127.0.0.1:61208")


def _normalize_base_url(url):
    return (url or "").strip().rstrip("/")


def _preflight():
    if not _normalize_base_url(GLANCES_BASE_URL):
        return ["GLANCES_BASE_URL is not set."]
    return []


def _api_get_json(path, timeout=10):
    errors = _preflight()
    if errors:
        return {"error": "Pre-flight check failed", "details": errors}

    normalized_path = path if path.startswith("/") else f"/{path}"
    url = f"{_normalize_base_url(GLANCES_BASE_URL)}{normalized_path}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return {"output": json.loads(resp.read().decode())}
    except urllib.error.HTTPError as e:
        body_text = e.read().decode(errors="replace")
        return {"error": f"HTTP {e.code}: {e.reason}", "url": url, "body": body_text[:500]}
    except Exception as e:
        return {"error": str(e), "url": url}


def _bytes_to_gib(value):
    try:
        return round(float(value) / (1024 ** 3), 2)
    except (TypeError, ValueError):
        return None


def _select_fs_entry(entries, mount_point, fallback_first=True):
    if not isinstance(entries, list):
        return None

    if mount_point:
        for entry in entries:
            if entry.get("mnt_point") == mount_point:
                return entry

    if fallback_first:
        return entries[0] if entries else None

    return None


def _shape_disk(entry):
    if not isinstance(entry, dict):
        return entry
    return {
        "mount_point": entry.get("mnt_point"),
        "device_name": entry.get("device_name"),
        "fs_type": entry.get("fs_type"),
        "percent_used": entry.get("percent"),
        "used_bytes": entry.get("used"),
        "used_gib": _bytes_to_gib(entry.get("used")),
        "free_bytes": entry.get("free"),
        "free_gib": _bytes_to_gib(entry.get("free")),
        "size_bytes": entry.get("size"),
        "size_gib": _bytes_to_gib(entry.get("size")),
    }


def handle_glances_summary_get(args):
    mount_point = args.get("mount_point", "/")

    quicklook = _api_get_json("/api/3/quicklook")
    if "error" in quicklook:
        return quicklook

    fs = _api_get_json("/api/3/fs")
    if "error" in fs:
        return fs

    uptime = _api_get_json("/api/3/uptime")
    if "error" in uptime:
        return uptime

    disk = _shape_disk(_select_fs_entry(fs["output"], mount_point, fallback_first=False))
    if mount_point and disk is None:
        return {"error": f"No filesystem found for mount_point '{mount_point}'"}

    quicklook_output = quicklook["output"]
    return {
        "output": {
            "cpu_percent": quicklook_output.get("cpu"),
            "memory_percent": quicklook_output.get("mem"),
            "swap_percent": quicklook_output.get("swap"),
            "cpu_name": quicklook_output.get("cpu_name"),
            "uptime": uptime["output"],
            "disk": disk,
            "source_url": _normalize_base_url(GLANCES_BASE_URL),
        }
    }


def handle_glances_cpu_get(args):
    include_percpu = bool(args.get("include_percpu"))

    cpu = _api_get_json("/api/3/cpu")
    if "error" in cpu:
        return cpu

    output = dict(cpu["output"])
    if include_percpu:
        quicklook = _api_get_json("/api/3/quicklook")
        if "error" in quicklook:
            return quicklook
        output["percpu"] = quicklook["output"].get("percpu", [])

    return {"output": output}


def handle_glances_memory_get(args):
    result = _api_get_json("/api/3/mem")
    if "error" in result:
        return result

    mem = result["output"]
    return {
        "output": {
            "percent_used": mem.get("percent"),
            "used_bytes": mem.get("used"),
            "used_gib": _bytes_to_gib(mem.get("used")),
            "available_bytes": mem.get("available"),
            "available_gib": _bytes_to_gib(mem.get("available")),
            "free_bytes": mem.get("free"),
            "free_gib": _bytes_to_gib(mem.get("free")),
            "total_bytes": mem.get("total"),
            "total_gib": _bytes_to_gib(mem.get("total")),
        }
    }


def handle_glances_disk_get(args):
    mount_point = args.get("mount_point", "/")
    result = _api_get_json("/api/3/fs")
    if "error" in result:
        return result

    entry = _select_fs_entry(result["output"], mount_point, fallback_first=False)
    if entry is None:
        return {"error": f"No filesystem found for mount_point '{mount_point}'"}

    return {"output": _shape_disk(entry)}


def handle_glances_endpoint_get(args):
    path = str(args.get("path", "")).strip()
    if not path:
        return {"error": "path is required"}
    if not path.startswith("/api/3/"):
        return {"error": "path must start with /api/3/"}
    return _api_get_json(path, timeout=20)


TOOLS = {
    "glances_summary_get": {
        "description": "Get a compact Glances summary with CPU, memory, uptime, and one filesystem.",
        "input_schema": {
            "type": "object",
            "properties": {
                "mount_point": {
                    "type": "string",
                    "description": "Filesystem mount point to summarize (default: /).",
                    "default": "/",
                }
            },
            "additionalProperties": False,
        },
        "handler": handle_glances_summary_get,
    },
    "glances_cpu_get": {
        "description": "Get current CPU metrics from Glances.",
        "input_schema": {
            "type": "object",
            "properties": {
                "include_percpu": {
                    "type": "boolean",
                    "description": "Include per-core CPU usage from the quicklook endpoint.",
                    "default": False,
                }
            },
            "additionalProperties": False,
        },
        "handler": handle_glances_cpu_get,
    },
    "glances_memory_get": {
        "description": "Get current memory usage metrics from Glances.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
        "handler": handle_glances_memory_get,
    },
    "glances_disk_get": {
        "description": "Get filesystem usage metrics for one mount point from Glances.",
        "input_schema": {
            "type": "object",
            "properties": {
                "mount_point": {
                    "type": "string",
                    "description": "Filesystem mount point to query (default: /).",
                    "default": "/",
                }
            },
            "additionalProperties": False,
        },
        "handler": handle_glances_disk_get,
    },
    "glances_endpoint_get": {
        "description": "Fetch a raw JSON payload from a specific Glances /api/3 endpoint.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Glances API path beginning with /api/3/ (for example /api/3/uptime).",
                }
            },
            "required": ["path"],
            "additionalProperties": False,
        },
        "handler": handle_glances_endpoint_get,
    },
}


def manifest():
    return {
        "tools": [
            {
                "name": name,
                "description": info["description"],
                "input_schema": info["input_schema"],
            }
            for name, info in TOOLS.items()
        ]
    }


def call(tool, args):
    if tool not in TOOLS:
        return {"error": f"Unknown tool: {tool}"}
    return TOOLS[tool]["handler"](args)


def main():
    payload = json.load(sys.stdin)
    method = payload["method"]
    if method == "manifest":
        print(json.dumps(manifest()))
    elif method == "call":
        print(json.dumps(call(payload["tool"], payload.get("args", {}))))


if __name__ == "__main__":
    main()
