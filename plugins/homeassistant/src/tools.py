#!/usr/bin/env python3
"""
OpenClaw plugin tools wrapper for Home Assistant REST API.

Provides tools that call the HA REST API directly via urllib:
  - hass_state_get: Get state of an entity
  - hass_state_list: List entities (optionally filtered by domain)
  - hass_service_call: Call a Home Assistant service
  - hass_event_list: List HA event types
  - hass_person_find: Find a person entity by name or entity_id
  - hass_speaker_volume_get: Get the volume of a speaker (media_player entity)
  - hass_speaker_volume_set: Set the volume of a speaker (media_player entity)
  - hass_logbook: Get logbook entries with optional entity, date range, and keyword filters
  - hass_camera_list: List available cameras and their entity IDs
  - hass_camera_snapshot: Take a snapshot from a named camera
"""

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta


HASS_SERVER = os.environ.get("HASS_SERVER", "http://192.168.1.76:8123")
HASS_TOKEN = os.environ.get("HASS_TOKEN", "")


def _configure(plugin_config: dict | None = None):
    """Set module globals from plugin_config, falling back to env."""
    global HASS_SERVER, HASS_TOKEN
    if plugin_config:
        HASS_SERVER = plugin_config.get("server") or HASS_SERVER
        HASS_TOKEN = plugin_config.get("token") or HASS_TOKEN


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _preflight():
    """Check that HASS_SERVER and HASS_TOKEN are configured."""
    errors = []
    if not HASS_TOKEN:
        errors.append("HASS_TOKEN is not set.")
    if not HASS_SERVER:
        errors.append("HASS_SERVER is not set.")
    return errors


def _api_get(path, timeout=30):
    """GET {HASS_SERVER}{path} and return parsed JSON or error dict."""
    errors = _preflight()
    if errors:
        return {"error": "Pre-flight check failed", "details": errors}
    url = f"{HASS_SERVER}{path}"
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {HASS_TOKEN}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return {"output": json.loads(resp.read().decode())}
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}: {e.reason}", "url": url}
    except Exception as e:
        return {"error": str(e)}


def _api_post(path, body=None, timeout=30):
    """POST {HASS_SERVER}{path} with JSON body and return parsed JSON or error dict."""
    errors = _preflight()
    if errors:
        return {"error": "Pre-flight check failed", "details": errors}
    url = f"{HASS_SERVER}{path}"
    data = json.dumps(body or {}).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Authorization": f"Bearer {HASS_TOKEN}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return {"output": json.loads(resp.read().decode())}
    except urllib.error.HTTPError as e:
        body_text = e.read().decode(errors="replace")
        return {"error": f"HTTP {e.code}: {e.reason}", "body": body_text[:500]}
    except Exception as e:
        return {"error": str(e)}


def _clean_entity(entity, compact=False):
    """Strip noisy fields from a HA entity dict.

    compact=True returns only entity_id, state, and friendly_name (for large lists).
    """
    if not isinstance(entity, dict):
        return entity
    entity.pop("context", None)
    if compact:
        return {
            "entity_id": entity.get("entity_id"),
            "state": entity.get("state"),
            "friendly_name": entity.get("attributes", {}).get("friendly_name"),
        }
    # Full mode: keep attributes but drop context
    return entity


def _extract_volume_info(entity):
    """Extract volume-relevant fields from a media_player entity dict."""
    if not isinstance(entity, dict):
        return entity
    attrs = entity.get("attributes", {})
    return {
        "entity_id": entity.get("entity_id"),
        "friendly_name": attrs.get("friendly_name"),
        "state": entity.get("state"),
        "volume_level": attrs.get("volume_level"),
        "is_volume_muted": attrs.get("is_volume_muted"),
    }


# ---------------------------------------------------------------------------
# Tool handlers
# ---------------------------------------------------------------------------

def handle_state_get(args):
    """Get the state of a specific entity with full attributes."""
    entity_id = args.get("entity_id", "")
    if not entity_id:
        return {"error": "entity_id is required"}
    result = _api_get(f"/api/states/{urllib.parse.quote(entity_id, safe='')}")
    if "error" in result:
        return result
    return {"output": _clean_entity(result["output"])}


def handle_state_list(args):
    """List entities, with optional domain filter and compact output for large sets."""
    domain = args.get("domain", "")
    result = _api_get("/api/states", timeout=60)
    if "error" in result:
        return result
    data = result["output"]
    if not isinstance(data, list):
        return result
    if domain:
        data = [e for e in data if e.get("entity_id", "").startswith(f"{domain}.")]
    compact = not domain or len(data) > 100
    cleaned = [_clean_entity(e, compact=compact) for e in data]
    return {"output": cleaned, "count": len(cleaned)}


def handle_service_call(args):
    """Call a Home Assistant service."""
    domain = args.get("domain", "")
    service = args.get("service", "")
    entity_id = args.get("entity_id", "")
    data = args.get("data") or {}

    if not domain or not service:
        return {"error": "domain and service are required"}

    body = dict(data)
    if entity_id:
        body["entity_id"] = entity_id

    result = _api_post(f"/api/services/{domain}/{service}", body=body)
    if "error" in result:
        return result
    return {"output": result["output"]}


def handle_event_list(args):
    """List HA event types with listener counts (REST /api/events)."""
    result = _api_get("/api/events")
    if "error" in result:
        return result
    data = result["output"]
    # Optional keyword filter via entity_id arg (matches against event_type string)
    entity_id = args.get("entity_id", "")
    if entity_id and isinstance(data, list):
        data = [e for e in data if entity_id in e.get("event_type", "")]
    return {"output": data}


def handle_person_find(args):
    """Find a person entity by name or entity_id."""
    name = args.get("name", "")
    entity_id = args.get("entity_id", "")

    if not name and not entity_id:
        return {"error": "name or entity_id is required"}

    # Direct lookup by entity_id
    if entity_id:
        result = _api_get(f"/api/states/{urllib.parse.quote(entity_id, safe='')}")
        if "error" in result:
            return result
        return {"output": _clean_entity(result["output"])}

    # Search all states, filter to person.* domain, match by name
    result = _api_get("/api/states", timeout=30)
    if "error" in result:
        return result
    data = result["output"]
    if not isinstance(data, list):
        return result

    name_lower = name.lower()
    matches = []
    for entity in data:
        if not isinstance(entity, dict):
            continue
        if not entity.get("entity_id", "").startswith("person."):
            continue
        friendly_name = entity.get("attributes", {}).get("friendly_name", "")
        eid = entity.get("entity_id", "")
        if name_lower in friendly_name.lower() or name_lower in eid.lower():
            matches.append(_clean_entity(entity))

    if not matches:
        return {"output": [], "count": 0, "message": f"No person found matching '{name}'"}
    return {"output": matches, "count": len(matches)}


def handle_speaker_volume_get(args):
    """Get the volume of one or all media_player (speaker) entities."""
    entity_id = args.get("entity_id", "")

    if entity_id:
        result = _api_get(f"/api/states/{urllib.parse.quote(entity_id, safe='')}")
        if "error" in result:
            return result
        return {"output": _extract_volume_info(result["output"])}

    # No entity_id — list all states, filter to media_player.*
    result = _api_get("/api/states", timeout=30)
    if "error" in result:
        return result
    data = result["output"]
    if not isinstance(data, list):
        return result
    volumes = [
        _extract_volume_info(e)
        for e in data
        if e.get("entity_id", "").startswith("media_player.")
    ]
    return {"output": volumes, "count": len(volumes)}


def handle_speaker_volume_set(args):
    """Set the volume of a media_player (speaker) entity."""
    entity_id = args.get("entity_id", "")
    volume_level = args.get("volume_level")

    if not entity_id:
        return {"error": "entity_id is required"}
    if volume_level is None:
        return {"error": "volume_level is required"}

    try:
        volume_level = float(volume_level)
    except (TypeError, ValueError):
        return {"error": "volume_level must be a number between 0.0 and 1.0"}

    if not 0.0 <= volume_level <= 1.0:
        return {"error": "volume_level must be between 0.0 and 1.0"}

    return handle_service_call({
        "domain": "media_player",
        "service": "volume_set",
        "entity_id": entity_id,
        "data": {"volume_level": volume_level},
    })


def handle_logbook(args):
    """Get Home Assistant logbook entries with optional filters."""
    errors = _preflight()
    if errors:
        return {"error": "Pre-flight check failed", "details": errors}

    # Date range: default last 24h
    hours = args.get("hours", 24)
    start_time = args.get("start_time")  # ISO string, e.g. "2026-04-07T00:00:00"
    end_time = args.get("end_time")      # ISO string
    entity_id = args.get("entity_id", "")
    keyword = args.get("keyword", "").lower()
    limit = min(int(args.get("limit", 100)), 500)

    # Build start timestamp
    if start_time:
        start_dt = start_time
    else:
        dt = datetime.now(timezone.utc) - timedelta(hours=hours)
        start_dt = dt.strftime("%Y-%m-%dT%H:%M:%S+00:00")

    url = f"{HASS_SERVER}/api/logbook/{urllib.parse.quote(start_dt, safe=':+-')}"
    params = {}
    if end_time:
        params["end_time"] = end_time
    if entity_id:
        params["entity"] = entity_id
    if params:
        url += "?" + urllib.parse.urlencode(params)

    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {HASS_TOKEN}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            entries = json.loads(resp.read().decode())
    except Exception as e:
        return {"error": str(e)}

    if not isinstance(entries, list):
        return {"error": "Unexpected response from HA logbook API", "raw": str(entries)[:500]}

    # Filter by keyword if provided
    if keyword:
        entries = [
            e for e in entries
            if keyword in e.get("name", "").lower()
            or keyword in e.get("message", "").lower()
            or keyword in e.get("entity_id", "").lower()
            or keyword in e.get("state", "").lower()
        ]

    # Trim to limit
    entries = entries[:limit]

    # Clean up entries for readability
    cleaned = []
    for e in entries:
        cleaned.append({
            "when": e.get("when"),
            "entity_id": e.get("entity_id"),
            "name": e.get("name"),
            "state": e.get("state"),
            "message": e.get("message"),
            "domain": e.get("domain"),
        })

    return {"count": len(cleaned), "entries": cleaned}



# ---------------------------------------------------------------------------
# Camera tools
# ---------------------------------------------------------------------------

CAMERAS = {
    "living-room":            "camera.living_room_camera_high_resolution_channel",
    "front-doorbell":         "camera.front_doorbell_camera_high_resolution_channel",
    "front-doorbell-package": "camera.front_doorbell_camera_package_camera",
    "backyard-right":         "camera.backyard_right_camera_high_resolution_channel",
    "backyard-left":          "camera.backyard_left_camera_high_resolution_channel_2",
    "driveway":               "camera.driveway_camera_high_resolution_channel",
    "family-room":            "camera.family_room_camera_high_resolution_channel",
    "garage":                 "camera.garage_camera_high_resolution_channel",
}

CAPTURE_DIR = "/tmp/openclaw/camera_captures"


def _camera_snapshot(name, entity_id):
    """Download a camera snapshot via HA camera_proxy API. Returns local file path or None."""
    errors = _preflight()
    if errors:
        return None

    os.makedirs(CAPTURE_DIR, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    local_filepath = os.path.join(CAPTURE_DIR, f"{name}_{timestamp}.jpg")

    url = f"{HASS_SERVER}/api/camera_proxy/{entity_id}"
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {HASS_TOKEN}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
    except Exception:
        return None

    if len(data) < 3 or data[:2] != b"\xff\xd8":
        return None

    with open(local_filepath, "wb") as f:
        f.write(data)

    return local_filepath


def handle_camera_list(_args):
    """List available cameras and their entity IDs."""
    return {
        "cameras": [
            {"name": name, "entity_id": entity_id}
            for name, entity_id in CAMERAS.items()
        ]
    }


def handle_camera_snapshot(args):
    """Take a snapshot from a named camera."""
    camera_name = args.get("camera_name", "")
    if not camera_name:
        return {"error": "camera_name is required"}

    errors = _preflight()
    if errors:
        return {"error": "Pre-flight check failed", "details": errors}

    if camera_name == "all":
        results, failures = [], []
        for name, entity_id in CAMERAS.items():
            path = _camera_snapshot(name, entity_id)
            if path:
                results.append({"camera": name, "file": path})
            else:
                failures.append(name)
        response = {"snapshots": results}
        if failures:
            response["failed"] = failures
        return response

    if camera_name not in CAMERAS:
        return {
            "error": f"Unknown camera: '{camera_name}'",
            "available": list(CAMERAS.keys()) + ["all"],
        }

    path = _camera_snapshot(camera_name, CAMERAS[camera_name])
    if path:
        return {"camera": camera_name, "file": path}
    return {"error": f"Snapshot failed for camera '{camera_name}'"}

# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------

def handle_camera_collage(args):
    """Snapshot multiple cameras and compose them into a grid collage image."""
    errors = _preflight()
    if errors:
        return {"error": "Pre-flight check failed", "details": errors}

    camera_names = args.get("camera_names")
    label = args.get("label", True)

    if not camera_names:
        camera_names = ["front-doorbell", "front-doorbell-package", "driveway",
                        "backyard-left", "backyard-right", "garage"]

    unknown = [n for n in camera_names if n not in CAMERAS]
    if unknown:
        return {"error": f"Unknown cameras: {unknown}", "available": list(CAMERAS.keys())}

    snapshots = []
    failed = []
    for name in camera_names:
        path = _camera_snapshot(name, CAMERAS[name])
        if path:
            snapshots.append((name, path))
        else:
            failed.append(name)

    if not snapshots:
        return {"error": "All camera snapshots failed", "failed": failed}

    import math, subprocess
    n = len(snapshots)
    cols = math.ceil(math.sqrt(n))
    rows = math.ceil(n / cols)
    scale_w, scale_h = 640, 360

    # Build per-image scale+label filters
    filter_parts = []
    for i, (name, _) in enumerate(snapshots):
        f = (f"[{i}:v]scale={scale_w}:{scale_h}:force_original_aspect_ratio=decrease,"
             f"pad={scale_w}:{scale_h}:(ow-iw)/2:(oh-ih)/2")
        if label:
            f += (f",drawtext=text='{name}':fontsize=18:fontcolor=white:"
                  f"x=10:y=h-th-10:box=1:boxcolor=black@0.5:boxborderw=4")
        f += f"[v{i}]"
        filter_parts.append(f)

    # Build xstack layout using only actual snapshot count
    layout_parts = []
    for i in range(n):
        row, col = divmod(i, cols)
        x = str(col * scale_w) if col > 0 else "0"
        y = str(row * scale_h) if row > 0 else "0"
        layout_parts.append(f"{x}_{y}")

    xstack = (f"{''.join(f'[v{i}]' for i in range(n))}"
              f"xstack=inputs={n}:layout={'|'.join(layout_parts)}[out]")
    filter_parts.append(xstack)
    filter_complex = ";".join(filter_parts)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    os.makedirs(CAPTURE_DIR, exist_ok=True)
    out_path = os.path.join(CAPTURE_DIR, f"collage_{timestamp}.jpg")

    cmd = ["ffmpeg", "-y"]
    for _, path in snapshots:
        cmd += ["-i", path]
    cmd += ["-filter_complex", filter_complex, "-map", "[out]", "-frames:v", "1", "-update", "1", "-q:v", "3", out_path]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except Exception as e:
        return {"error": f"ffmpeg failed: {e}"}

    if result.returncode != 0:
        return {"error": "ffmpeg error", "stderr": result.stderr[-500:]}

    size_kb = os.path.getsize(out_path) / 1024
    response = {"file": out_path, "cameras": [name for name, _ in snapshots], "size_kb": round(size_kb)}
    if failed:
        response["failed"] = failed
    return response

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except Exception as e:
        return {"error": f"ffmpeg failed: {e}"}

    if result.returncode != 0:
        return {"error": "ffmpeg error", "stderr": result.stderr[-500:]}

    size_kb = os.path.getsize(out_path) / 1024
    response = {"file": out_path, "cameras": [n for n, _ in snapshots[:n]], "size_kb": round(size_kb)}
    if failed:
        response["failed"] = failed
    return response


TOOLS = {
    "hass_state_get": {
        "description": "Get the current state of a Home Assistant entity.",
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_id": {
                    "type": "string",
                    "description": "The entity ID to query (e.g. light.living_room, sensor.temperature).",
                }
            },
            "required": ["entity_id"],
        },
        "handler": handle_state_get,
    },
    "hass_state_list": {
        "description": "List Home Assistant entities, optionally filtered by domain.",
        "input_schema": {
            "type": "object",
            "properties": {
                "domain": {
                    "type": "string",
                    "description": "Optional domain to filter by (e.g. light, switch, sensor).",
                }
            },
        },
        "handler": handle_state_list,
    },
    "hass_service_call": {
        "description": "Call a Home Assistant service.",
        "input_schema": {
            "type": "object",
            "properties": {
                "domain": {
                    "type": "string",
                    "description": "Service domain (e.g. light, switch, scene, climate).",
                },
                "service": {
                    "type": "string",
                    "description": "Service name (e.g. turn_on, turn_off, toggle).",
                },
                "entity_id": {
                    "type": "string",
                    "description": "Target entity ID (e.g. light.living_room).",
                },
                "data": {
                    "type": "object",
                    "description": "Additional service data as key-value pairs (e.g. {\"brightness\": 128}).",
                },
            },
            "required": ["domain", "service"],
        },
        "handler": handle_service_call,
    },
    "hass_event_list": {
        "description": "List Home Assistant event types.",
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_id": {
                    "type": "string",
                    "description": "Optional keyword to filter event types by string match.",
                }
            },
        },
        "handler": handle_event_list,
    },
    "hass_person_find": {
        "description": "Find a Home Assistant person by name or entity ID.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Name of the person to search for (case-insensitive substring match).",
                },
                "entity_id": {
                    "type": "string",
                    "description": "Exact entity ID to look up (e.g. person.john).",
                },
            },
        },
        "handler": handle_person_find,
    },
    "hass_speaker_volume_get": {
        "description": "Get the volume level of one speaker or all speakers.",
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_id": {
                    "type": "string",
                    "description": "Optional entity ID of the speaker (e.g. media_player.living_room).",
                }
            },
        },
        "handler": handle_speaker_volume_get,
    },
    "hass_speaker_volume_set": {
        "description": "Set the volume level of a speaker.",
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_id": {
                    "type": "string",
                    "description": "Entity ID of the speaker to adjust (e.g. media_player.living_room).",
                },
                "volume_level": {
                    "type": "number",
                    "description": "Desired volume level between 0.0 (silent) and 1.0 (maximum).",
                    "minimum": 0.0,
                    "maximum": 1.0,
                },
            },
            "required": ["entity_id", "volume_level"],
        },
        "handler": handle_speaker_volume_set,
    },
    "hass_camera_list": {
        "description": "List available Home Assistant cameras.",
        "input_schema": {
            "type": "object",
            "properties": {},
        },
        "handler": handle_camera_list,
    },
    "hass_camera_snapshot": {
        "description": "Take a snapshot from a Home Assistant camera.",
        "input_schema": {
            "type": "object",
            "properties": {
                "camera_name": {
                    "type": "string",
                    "description": (
                        "Name of the camera to snapshot. "
                        "One of: living-room, front-doorbell, front-doorbell-package, "
                        "backyard-right, backyard-left, driveway, family-room, garage, all"
                    ),
                }
            },
            "required": ["camera_name"],
        },
        "handler": handle_camera_snapshot,
    },
    "hass_logbook": {
        "description": "Get Home Assistant logbook entries with optional filters.",
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_id": {
                    "type": "string",
                    "description": "Filter entries for a specific entity (e.g. binary_sensor.front_doorbell_camera_doorbell).",
                },
                "hours": {
                    "type": "number",
                    "description": "Rolling window in hours from now (default: 24). Ignored if start_time is provided.",
                },
                "start_time": {
                    "type": "string",
                    "description": "Start of the time range as an ISO 8601 string (e.g. '2026-04-07T00:00:00+00:00').",
                },
                "end_time": {
                    "type": "string",
                    "description": "End of the time range as an ISO 8601 string. Defaults to now.",
                },
                "keyword": {
                    "type": "string",
                    "description": "Optional keyword to filter entries by name, message, entity_id, or state.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of entries to return (default: 100, max: 500).",
                },
            },
        },
        "handler": handle_logbook,
    },
    "hass_camera_collage": {
        "description": (
            "Snapshot multiple cameras simultaneously and compose them into a grid collage image. "
            "Defaults to all outdoor + garage cameras. Returns a single local file path to the collage image."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "camera_names": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "List of camera names to include. Defaults to all outdoor + garage cameras: "
                        "front-doorbell, front-doorbell-package, driveway, backyard-left, backyard-right, garage. "
                        "Available: living-room, front-doorbell, front-doorbell-package, backyard-right, "
                        "backyard-left, driveway, family-room, garage."
                    ),
                },
                "label": {
                    "type": "boolean",
                    "description": "Draw camera name labels on each cell (default: true).",
                },
            },
        },
        "handler": handle_camera_collage,
    },
}


# ---------------------------------------------------------------------------
# Standard dispatch
# ---------------------------------------------------------------------------

def manifest():
    return {
        "tools": [
            {
                "name": k,
                "description": v["description"],
                "input_schema": v["input_schema"],
            }
            for k, v in TOOLS.items()
        ]
    }


def call(tool, args, plugin_config=None):
    _configure(plugin_config)
    if tool not in TOOLS:
        return {"error": f"Unknown tool: {tool}"}
    return TOOLS[tool]["handler"](args)


def main():
    payload = json.load(sys.stdin)
    if payload["method"] == "manifest":
        print(json.dumps(manifest()))
    elif payload["method"] == "call":
        print(json.dumps(call(payload["tool"], payload["args"], payload.get("plugin_config"))))


if __name__ == "__main__":
    main()
