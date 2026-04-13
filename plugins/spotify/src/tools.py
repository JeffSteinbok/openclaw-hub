"""Spotify plugin tools — JSON stdin/stdout dispatch layer.

Wraps spotipy calls as structured tool handlers for the OpenClaw Python
plugin framework.
"""

import json
import os
import sys

# Ensure sibling modules are importable
sys.path.insert(0, os.path.dirname(__file__))

from spotify_client import get_client


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------

def handle_now_playing(args: dict) -> dict:
    """Get the currently playing track or episode."""
    try:
        sp = get_client()
        current = sp.current_playback()

        if not current or not current.get("item"):
            return {"playing": False}

        item = current["item"]
        item_type = item.get("type", "track")
        result = {
            "playing": current["is_playing"],
            "item_type": item_type,
            "track": item["name"],
            "track_uri": item["uri"],
            "progress_ms": current.get("progress_ms"),
            "duration_ms": item.get("duration_ms"),
        }

        if item_type == "episode":
            show = item.get("show") or {}
            result["artist"] = show.get("publisher") or show.get("name", "")
            result["album"] = show.get("name", "")
            if show.get("publisher"):
                result["publisher"] = show["publisher"]
            if show.get("name"):
                result["show"] = show["name"]
        else:
            result["artist"] = ", ".join(a["name"] for a in item.get("artists", []))
            result["album"] = (item.get("album") or {}).get("name", "")

        device = current.get("device")
        if device:
            result["device"] = device["name"]

        return result
    except Exception as e:
        return {"error": str(e)}


def handle_play(args: dict) -> dict:
    """Start or resume playback."""
    try:
        sp = get_client()
        kwargs = {}

        device_id = args.get("device_id")
        if device_id:
            kwargs["device_id"] = device_id

        uri = args.get("uri")
        if uri:
            # Single track or episode
            if uri.startswith("spotify:track:") or uri.startswith("spotify:episode:"):
                kwargs["uris"] = [uri]
            else:
                # Album, artist, or playlist
                kwargs["context_uri"] = uri

        sp.start_playback(**kwargs)
        return {"status": "ok"}
    except Exception as e:
        return {"error": str(e)}


def handle_pause(args: dict) -> dict:
    """Pause playback."""
    try:
        sp = get_client()
        device_id = args.get("device_id")
        sp.pause_playback(device_id=device_id)
        return {"status": "ok"}
    except Exception as e:
        return {"error": str(e)}


def handle_next(args: dict) -> dict:
    """Skip to the next track."""
    try:
        sp = get_client()
        device_id = args.get("device_id")
        sp.next_track(device_id=device_id)
        return {"status": "ok"}
    except Exception as e:
        return {"error": str(e)}


def handle_previous(args: dict) -> dict:
    """Go back to the previous track."""
    try:
        sp = get_client()
        device_id = args.get("device_id")
        sp.previous_track(device_id=device_id)
        return {"status": "ok"}
    except Exception as e:
        return {"error": str(e)}


def handle_search(args: dict) -> dict:
    """Search Spotify for tracks, albums, artists, or playlists."""
    try:
        query = args.get("query", "").strip()
        if not query:
            return {"error": "query is required"}

        search_type = args.get("type", "track")
        limit = min(args.get("limit", 10), 50)

        sp = get_client()
        results = sp.search(q=query, type=search_type, limit=limit)

        formatted = []
        type_key = search_type + "s"  # e.g. "track" -> "tracks"
        items = results.get(type_key, {}).get("items", [])

        for item in items:
            entry = {"name": item["name"], "uri": item["uri"]}

            if search_type == "track":
                entry["artist"] = ", ".join(a["name"] for a in item.get("artists", []))
                entry["album"] = item.get("album", {}).get("name", "")
                entry["duration_ms"] = item.get("duration_ms")
            elif search_type == "album":
                entry["artist"] = ", ".join(a["name"] for a in item.get("artists", []))
                entry["total_tracks"] = item.get("total_tracks")
                entry["release_date"] = item.get("release_date", "")
            elif search_type == "artist":
                entry["genres"] = item.get("genres", [])
                entry["followers"] = item.get("followers", {}).get("total")
            elif search_type == "playlist":
                entry["owner"] = item.get("owner", {}).get("display_name", "")
                entry["total_tracks"] = item.get("tracks", {}).get("total")

            formatted.append(entry)

        return {"results": formatted, "total": results.get(type_key, {}).get("total", 0)}
    except Exception as e:
        return {"error": str(e)}


def handle_add_to_playlist(args: dict) -> dict:
    """Add a track to a playlist."""
    try:
        playlist_id = args.get("playlist_id", "").strip()
        track_uri = args.get("track_uri", "").strip()

        if not playlist_id or not track_uri:
            return {"error": "playlist_id and track_uri are required"}

        sp = get_client()
        sp.playlist_add_items(playlist_id, [track_uri])
        return {"status": "ok"}
    except Exception as e:
        return {"error": str(e)}


def handle_get_playlists(args: dict) -> dict:
    """List the user's playlists."""
    try:
        limit = min(args.get("limit", 20), 50)

        sp = get_client()
        results = sp.current_user_playlists(limit=limit)

        playlists = []
        for item in results.get("items", []):
            playlists.append({
                "name": item["name"],
                "id": item["id"],
                "uri": item["uri"],
                "total_tracks": item.get("tracks", {}).get("total", 0),
                "owner": item.get("owner", {}).get("display_name", ""),
            })

        return {"playlists": playlists}
    except Exception as e:
        return {"error": str(e)}


def handle_get_devices(args: dict) -> dict:
    """List available Spotify Connect devices."""
    try:
        sp = get_client()
        results = sp.devices()

        devices = []
        for d in results.get("devices", []):
            devices.append({
                "id": d["id"],
                "name": d["name"],
                "type": d["type"],
                "is_active": d["is_active"],
                "volume_percent": d.get("volume_percent"),
            })

        return {"devices": devices}
    except Exception as e:
        return {"error": str(e)}


# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------

TOOLS = {
    "spotify_now_playing": {
        "description": "Get the currently playing item on Spotify, including playback details.",
        "input_schema": {
            "type": "object",
            "properties": {},
        },
        "handler": handle_now_playing,
    },
    "spotify_play": {
        "description": (
            "Start or resume Spotify playback. Optionally provide a Spotify URI "
            "(track, album, artist, or playlist) to play something specific."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "uri": {
                    "type": "string",
                    "description": "Spotify URI to play (e.g. spotify:track:..., spotify:album:..., spotify:playlist:...). Omit to resume current playback.",
                },
                "device_id": {
                    "type": "string",
                    "description": "Target device ID (from spotify_get_devices). Omit to use the active device.",
                },
            },
        },
        "handler": handle_play,
    },
    "spotify_pause": {
        "description": "Pause Spotify playback.",
        "input_schema": {
            "type": "object",
            "properties": {
                "device_id": {
                    "type": "string",
                    "description": "Target device ID. Omit to use the active device.",
                },
            },
        },
        "handler": handle_pause,
    },
    "spotify_next": {
        "description": "Skip to the next track in the Spotify queue.",
        "input_schema": {
            "type": "object",
            "properties": {
                "device_id": {
                    "type": "string",
                    "description": "Target device ID. Omit to use the active device.",
                },
            },
        },
        "handler": handle_next,
    },
    "spotify_previous": {
        "description": "Go back to the previous track on Spotify.",
        "input_schema": {
            "type": "object",
            "properties": {
                "device_id": {
                    "type": "string",
                    "description": "Target device ID. Omit to use the active device.",
                },
            },
        },
        "handler": handle_previous,
    },
    "spotify_search": {
        "description": (
            "Search Spotify for tracks, albums, artists, or playlists. "
            "Returns names, URIs, and metadata for use with other Spotify tools."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query (e.g. 'Daft Punk Digital Love', 'chill jazz playlist').",
                },
                "type": {
                    "type": "string",
                    "enum": ["track", "album", "artist", "playlist"],
                    "description": "Type of result to search for (default: track).",
                },
                "limit": {
                    "type": "integer",
                    "description": "Max number of results to return (default: 10, max: 50).",
                },
            },
            "required": ["query"],
        },
        "handler": handle_search,
    },
    "spotify_add_to_playlist": {
        "description": "Add a track to a Spotify playlist by playlist ID and track URI.",
        "input_schema": {
            "type": "object",
            "properties": {
                "playlist_id": {
                    "type": "string",
                    "description": "Spotify playlist ID (from spotify_get_playlists).",
                },
                "track_uri": {
                    "type": "string",
                    "description": "Spotify track URI to add (e.g. spotify:track:...).",
                },
            },
            "required": ["playlist_id", "track_uri"],
        },
        "handler": handle_add_to_playlist,
    },
    "spotify_get_playlists": {
        "description": "List the current user's Spotify playlists with IDs and track counts.",
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "Max number of playlists to return (default: 20, max: 50).",
                },
            },
        },
        "handler": handle_get_playlists,
    },
    "spotify_get_devices": {
        "description": "List available Spotify Connect devices (speakers, phones, computers) with their IDs and active status.",
        "input_schema": {
            "type": "object",
            "properties": {},
        },
        "handler": handle_get_devices,
    },
}


# ---------------------------------------------------------------------------
# JSON stdin/stdout dispatch
# ---------------------------------------------------------------------------

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


def call(tool: str, args: dict):
    return TOOLS[tool]["handler"](args)


def main():
    payload = json.load(sys.stdin)
    method = payload["method"]
    if method == "manifest":
        print(json.dumps(manifest()))
    elif method == "call":
        print(json.dumps(call(payload["tool"], payload.get("args", {}))))
    else:
        print(json.dumps({"error": f"Unknown method: {method}"}))


if __name__ == "__main__":
    main()
