#!/usr/bin/env python3
"""
OpenClaw plugin tools for Home Assistant LLM Vision integration.

Provides tools that call the HA REST API directly via urllib:
  - llmvision_timeline_get:   Get events from the LLM Vision timeline
  - llmvision_get_image:      Download a keyframe image from HA media storage
  - llmvision_analyze_image:  Trigger AI image analysis on a camera entity
  - llmvision_create_event:   Create a new event in the LLM Vision timeline
"""

import json
import os
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta


HASS_SERVER = os.environ.get("HASS_SERVER", "http://192.168.1.76:8123")
HASS_TOKEN = os.environ.get("HASS_TOKEN", "")


def _configure(plugin_config: dict | None = None):
    """Set module globals from plugin_config, falling back to env."""
    global HASS_SERVER, HASS_TOKEN
    if plugin_config:
        HASS_SERVER = plugin_config.get("server") or HASS_SERVER
        HASS_TOKEN = plugin_config.get("token") or HASS_TOKEN

VALID_LABELS = {
    "Alarm", "Bike", "Bird", "Bus", "Camera", "Car", "Cat", "Dog",
    "Door", "Key", "Light", "Lock", "Motorcycle", "Package", "Person",
    "Plant", "Sensor", "Tree", "Truck", "Van",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _preflight():
    """Return a list of configuration errors, or empty list if all good."""
    errors = []
    if not HASS_TOKEN:
        errors.append("HASS_TOKEN environment variable is not set.")
    if not HASS_SERVER:
        errors.append("HASS_SERVER environment variable is not set.")
    return errors


def _headers():
    return {
        "Authorization": f"Bearer {HASS_TOKEN}",
        "Content-Type": "application/json",
    }


def _ha_get(path, params=None):
    """Perform a GET request to the HA REST API.

    Returns (data, None) on success or (None, error_string) on failure.
    """
    url = f"{HASS_SERVER}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=_headers())
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode()), None
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:500]
        return None, f"HTTP {e.code}: {body}"
    except Exception as e:
        return None, str(e)


def _ha_post(path, body):
    """Perform a POST request to the HA REST API with a JSON body.

    Returns (data, None) on success or (None, error_string) on failure.
    """
    url = f"{HASS_SERVER}{path}"
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=_headers(), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode()), None
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:500]
        return None, f"HTTP {e.code}: {body}"
    except Exception as e:
        return None, str(e)


def _iso_now_plus_days(days):
    """Return an ISO 8601 UTC string offset by *days* from now."""
    dt = datetime.now(timezone.utc) + timedelta(days=days)
    return dt.strftime("%Y-%m-%dT%H:%M:%S+00:00")


def _iso_now():
    """Return the current UTC time as an ISO 8601 string."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")


# ---------------------------------------------------------------------------
# Tool handlers
# ---------------------------------------------------------------------------

def handle_timeline_get(args):
    """Get events from the LLM Vision timeline.

    Uses the LLM Vision native API endpoint /api/llmvision/timeline/events
    which returns the full event database.
    """
    errors = _preflight()
    if errors:
        return {"error": "Pre-flight check failed", "details": errors}

    days = int(args.get("days", 7))
    limit = min(int(args.get("limit", 50)), 200)
    start_time = args.get("start_time")
    end_time = args.get("end_time")

    data, err = _ha_get("/api/llmvision/timeline/events", params={"limit": limit})
    if err:
        return {"error": err}

    raw_events = data.get("events", []) if isinstance(data, dict) else data
    if not isinstance(raw_events, list):
        return {"error": "Unexpected response", "raw": str(data)[:500]}

    # Parse and filter by date range
    from datetime import datetime, timezone, timedelta
    if start_time:
        start_dt = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
    else:
        start_dt = datetime.now(timezone.utc) - timedelta(days=days)
    if end_time:
        end_dt = datetime.fromisoformat(end_time.replace("Z", "+00:00"))
    else:
        end_dt = datetime.now(timezone.utc)

    events = []
    for item in raw_events:
        if not isinstance(item, dict):
            continue
        start_str = item.get("start", "")
        try:
            item_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            if not (start_dt <= item_dt <= end_dt):
                continue
        except Exception:
            pass  # include if we can't parse
        events.append({
            "title": item.get("title", ""),
            "description": item.get("description", ""),
            "uid": item.get("uid", ""),
            "label": item.get("label", "") or item.get("category", ""),
            "camera": item.get("camera_name", ""),
            "key_frame": item.get("key_frame", ""),
            "start": item.get("start", ""),
            "end": item.get("end", ""),
        })

    # Sort newest first, apply limit
    events.sort(key=lambda e: e.get("start", ""), reverse=True)
    events = events[:limit]

    return {"count": len(events), "events": events}


KEYFRAME_DIR = "/tmp/openclaw/llmvision_keyframes"


def handle_get_image(args):
    """Download a keyframe image from HA LLM Vision media storage.

    Accepts a key_frame path like /media/llmvision/snapshots/xxx.jpg
    and fetches it from HA using HASS_TOKEN authentication.
    Returns the local file path for use with the image or message tools.
    """
    errors = _preflight()
    if errors:
        return {"error": "Pre-flight check failed", "details": errors}

    key_frame = args.get("key_frame", "").strip()
    if not key_frame:
        return {"error": "key_frame path is required (e.g. /media/llmvision/snapshots/xxx.jpg)"}

    # Build HA URL: /media/foo.jpg -> /media/local/foo.jpg
    if key_frame.startswith("/media/"):
        ha_path = "/media/local" + key_frame[len("/media"):]
    else:
        ha_path = key_frame

    url = f"{HASS_SERVER}{ha_path}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {HASS_TOKEN}"})

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}: {e.reason}", "url": url}
    except Exception as e:
        return {"error": str(e)}

    if len(data) < 3 or data[:2] != b"\xff\xd8":
        return {"error": "Response is not a valid JPEG", "url": url, "size": len(data)}

    # Save to temp dir
    import os
    os.makedirs(KEYFRAME_DIR, exist_ok=True)
    filename = key_frame.split("/")[-1]
    local_path = os.path.join(KEYFRAME_DIR, filename)
    with open(local_path, "wb") as f:
        f.write(data)

    return {"file": local_path, "size_kb": round(len(data) / 1024), "url": url}


def handle_analyze_image(args):
    """Trigger LLM Vision image analysis on a camera entity.

    Calls the llmvision.image_analyzer service and returns the AI description.
    """
    errors = _preflight()
    if errors:
        return {"error": "Pre-flight check failed", "details": errors}

    camera_entity = args.get("camera_entity", "").strip()
    message = args.get("message", "").strip()
    provider = args.get("provider", "").strip()

    if not camera_entity:
        return {"error": "camera_entity is required"}
    if not message:
        return {"error": "message (prompt) is required"}
    if not provider:
        return {"error": "provider is required"}

    service_data = {
        "entity_id": camera_entity,
        "message": message,
        "provider": provider,
    }

    # Optional fields
    if args.get("model"):
        service_data["model"] = args["model"]
    if "store_in_timeline" in args:
        service_data["store_in_timeline"] = bool(args["store_in_timeline"])
    if "expose_images" in args:
        service_data["expose_images"] = bool(args["expose_images"])
    if "generate_title" in args:
        service_data["generate_title"] = bool(args["generate_title"])
    if args.get("response_format") in ("text", "json"):
        service_data["response_format"] = args["response_format"]
    if args.get("max_tokens") is not None:
        try:
            service_data["max_tokens"] = int(args["max_tokens"])
        except (TypeError, ValueError):
            return {"error": "max_tokens must be an integer"}

    data, err = _ha_post("/api/services/llmvision/image_analyzer", service_data)
    if err:
        return {"error": err}

    return {"result": data}


def handle_create_event(args):
    """Create a new event in the LLM Vision timeline.

    Calls the llmvision.create_event service with the supplied fields.
    """
    errors = _preflight()
    if errors:
        return {"error": "Pre-flight check failed", "details": errors}

    title = args.get("title", "").strip()
    description = args.get("description", "").strip()

    if not title:
        return {"error": "title is required"}
    if not description:
        return {"error": "description is required"}

    label = args.get("label", "").strip()
    if label and label not in VALID_LABELS:
        return {
            "error": f"Invalid label '{label}'. Must be one of: {', '.join(sorted(VALID_LABELS))}"
        }

    service_data: dict = {
        "title": title,
        "description": description,
    }

    if label:
        service_data["label"] = label
    if args.get("image_path"):
        service_data["image_path"] = args["image_path"]
    if args.get("camera_entity"):
        service_data["entity_id"] = args["camera_entity"]
    if args.get("start_time"):
        service_data["start_time"] = args["start_time"]
    if args.get("end_time"):
        service_data["end_time"] = args["end_time"]

    data, err = _ha_post("/api/services/llmvision/create_event", service_data)
    if err:
        return {"error": err}

    return {"result": data}


# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------

TOOLS = {
    "llmvision_get_image": {
        "description": (
            "Download a keyframe image from HA LLM Vision media storage. "
            "Pass a key_frame path from a timeline event (e.g. /media/llmvision/snapshots/xxx.jpg). "
            "Returns the local file path for use with the image or message tools."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "key_frame": {
                    "type": "string",
                    "description": "The key_frame path from a timeline event (e.g. /media/llmvision/snapshots/abc123-camera0.jpg).",
                },
            },
            "required": ["key_frame"],
        },
        "handler": handle_get_image,
    },
    "llmvision_timeline_get": {
        "description": (
            "Get events from the LLM Vision timeline (calendar.llm_vision_timeline). "
            "Returns a list of AI-generated observation events with timestamps, summaries, "
            "and descriptions. Useful for reviewing what the cameras have seen recently."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "start_time": {
                    "type": "string",
                    "description": (
                        "Start of the query window as ISO 8601 (e.g. '2026-04-09T00:00:00+00:00'). "
                        "Defaults to now minus days."
                    ),
                },
                "end_time": {
                    "type": "string",
                    "description": (
                        "End of the query window as ISO 8601. "
                        "Defaults to now."
                    ),
                },
                "days": {
                    "type": "integer",
                    "description": "Number of days to look back when start_time is not set (default: 7).",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of events to return (default: 50, max: 200).",
                },
            },
        },
        "handler": handle_timeline_get,
    },
    "llmvision_analyze_image": {
        "description": (
            "Trigger an AI image analysis on a Home Assistant camera entity using LLM Vision. "
            "Sends the current camera snapshot to the specified AI provider with a custom prompt "
            "and returns the AI-generated description. Can optionally store the result in the timeline."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "camera_entity": {
                    "type": "string",
                    "description": "Camera entity ID to analyze (e.g. camera.front_door).",
                },
                "message": {
                    "type": "string",
                    "description": "Prompt / question to send to the AI about the image.",
                },
                "provider": {
                    "type": "string",
                    "description": "LLM Vision provider to use (e.g. 'anthropic', 'openai', 'ollama').",
                },
                "model": {
                    "type": "string",
                    "description": "Specific model override (optional, uses provider default if omitted).",
                },
                "store_in_timeline": {
                    "type": "boolean",
                    "description": "Whether to save the result as a timeline event (default: false).",
                },
                "expose_images": {
                    "type": "boolean",
                    "description": "Whether to expose the captured image in the timeline event.",
                },
                "generate_title": {
                    "type": "boolean",
                    "description": "Whether to auto-generate a title for the timeline event.",
                },
                "response_format": {
                    "type": "string",
                    "enum": ["text", "json"],
                    "description": "Response format from the AI: 'text' (default) or 'json'.",
                },
                "max_tokens": {
                    "type": "integer",
                    "description": "Maximum tokens for the AI response.",
                },
            },
            "required": ["camera_entity", "message", "provider"],
        },
        "handler": handle_analyze_image,
    },
    "llmvision_create_event": {
        "description": (
            "Create a new event in the LLM Vision timeline. "
            "Use this to manually log observations or detections with optional camera image, "
            "label category, and time range."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "Title of the timeline event.",
                },
                "description": {
                    "type": "string",
                    "description": "Detailed description or AI summary for the event.",
                },
                "label": {
                    "type": "string",
                    "enum": sorted(VALID_LABELS),
                    "description": (
                        "Optional category label for the event "
                        "(e.g. 'Person', 'Car', 'Package')."
                    ),
                },
                "image_path": {
                    "type": "string",
                    "description": "Optional path to an image file to attach to the event.",
                },
                "camera_entity": {
                    "type": "string",
                    "description": "Optional camera entity ID to capture an image from.",
                },
                "start_time": {
                    "type": "string",
                    "description": "Event start time as ISO 8601 (defaults to now).",
                },
                "end_time": {
                    "type": "string",
                    "description": "Event end time as ISO 8601 (defaults to start_time).",
                },
            },
            "required": ["title", "description"],
        },
        "handler": handle_create_event,
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
