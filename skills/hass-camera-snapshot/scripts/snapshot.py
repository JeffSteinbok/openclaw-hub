#!/usr/bin/env python3
"""
hass-camera-snapshot — Take snapshots from home security cameras via Home Assistant.

How it works:
  1. Calls the camera.snapshot service via hass-cli, which saves a JPEG on the
     HA server at /config/www/openclaw/snap_<camera>.jpg  (one file per camera,
     overwritten each time to avoid filling up the HA disk).
  2. Downloads that file to the local camera_captures/ directory with a timestamped
     filename so we keep a local history.
  3. Errors at each stage produce clear, actionable messages so the calling agent
     (or a human) knows exactly what went wrong and how to fix it.

Requirements:
  - HASS_SERVER and HASS_TOKEN env vars (set in ~/.bashrc via ~/.ha_token)
  - hass-cli installed and on PATH
  - curl installed and on PATH
  - On the HA server:
      * Directory /config/www/openclaw/ must exist
      * /config/www/openclaw must be in allowlist_external_dirs in configuration.yaml
"""

import shutil
import subprocess
import sys
import os
import time
from datetime import datetime

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Where downloaded snapshots are saved locally
CAPTURE_DIR = os.path.expanduser(
    "~/.openclaw/agents/main/workspace/camera_captures"
)

# Home Assistant connection (set via env, with sensible defaults)
HASS_SERVER = os.environ.get("HASS_SERVER", "http://192.168.1.76:8123")
HASS_TOKEN = os.environ.get("HASS_TOKEN", "")

# Path on the HA server where snapshots are temporarily saved.
# Must be inside allowlist_external_dirs in HA's configuration.yaml.
# Files here are served at {HASS_SERVER}/local/openclaw/<filename>
HA_SNAP_DIR = "/config/www/openclaw"

# Friendly name → Home Assistant entity_id mapping.
# Use --list to print this table.  "all" captures every camera below.
CAMERAS = {
    "living-room":           "camera.living_room_camera_high_resolution_channel",
    "front-doorbell":        "camera.front_doorbell_camera_high_resolution_channel",
    "front-doorbell-package": "camera.front_doorbell_camera_package_camera",
    "backyard-right":        "camera.backyard_right_camera_high_resolution_channel",
    "backyard-left":         "camera.backyard_left_camera_high_resolution_channel_2",
    "driveway":              "camera.driveway_camera_high_resolution_channel",
    "family-room":           "camera.family_room_camera_high_resolution_channel",
    "garage":                "camera.garage_camera_high_resolution_channel",
}

# How long to wait after asking HA to write the file before downloading (seconds)
SNAPSHOT_WRITE_DELAY = 2


# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------

def preflight():
    """Verify environment before attempting any snapshots.
    Returns a list of error strings (empty = all good)."""
    errors = []

    if not HASS_TOKEN:
        errors.append(
            "HASS_TOKEN is not set. "
            "Ensure ~/.bashrc exports it (e.g. from ~/.ha_token)."
        )

    if not HASS_SERVER:
        errors.append(
            "HASS_SERVER is not set. "
            "Export it in ~/.bashrc (e.g. http://192.168.1.76:8123)."
        )

    if not shutil.which("hass-cli"):
        errors.append(
            "hass-cli not found on PATH. "
            "Install: pip install homeassistant-cli"
        )

    if not shutil.which("curl"):
        errors.append("curl not found on PATH.")

    return errors


# ---------------------------------------------------------------------------
# Core snapshot logic
# ---------------------------------------------------------------------------

def snapshot(name, entity_id):
    """Capture a single camera and return the local file path, or None on failure.

    Steps:
      1. Ask HA to save a snapshot to its local www directory
      2. Download the image over HTTP to our local capture directory
    """
    os.makedirs(CAPTURE_DIR, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    # Fixed filename per camera on HA side (overwritten each call)
    ha_filename = f"snap_{name}.jpg"
    ha_filepath = f"{HA_SNAP_DIR}/{ha_filename}"
    # Timestamped filename locally so we keep history
    local_filename = f"{name}_{timestamp}.jpg"
    local_filepath = os.path.join(CAPTURE_DIR, local_filename)

    # -- Step 1: Tell HA to write the snapshot to its filesystem --
    try:
        result = subprocess.run(
            [
                "hass-cli", "service", "call", "camera.snapshot",
                "--arguments",
                f"entity_id={entity_id},filename={ha_filepath}",
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except subprocess.TimeoutExpired:
        print(
            f"ERROR [{name}]: hass-cli timed out after 30s. "
            f"Is Home Assistant reachable at {HASS_SERVER}?",
            file=sys.stderr,
        )
        return None
    except FileNotFoundError:
        print(
            f"ERROR [{name}]: hass-cli binary not found. "
            f"Is it installed? (pip install homeassistant-cli)",
            file=sys.stderr,
        )
        return None

    if result.returncode != 0:
        stderr = result.stderr.strip()
        if "500" in stderr:
            print(
                f"ERROR [{name}]: HA returned 500 Internal Server Error. "
                f"Likely causes:\n"
                f"  • {HA_SNAP_DIR} does not exist on the HA server "
                f"(run: mkdir -p {HA_SNAP_DIR} on HA)\n"
                f"  • {HA_SNAP_DIR} is not in allowlist_external_dirs "
                f"in configuration.yaml\n"
                f"  • The camera entity '{entity_id}' is unavailable or offline\n"
                f"  Raw error: {stderr}",
                file=sys.stderr,
            )
        elif "401" in stderr or "403" in stderr:
            print(
                f"ERROR [{name}]: HA authentication failed. "
                f"Check HASS_TOKEN is valid and not expired.\n"
                f"  Raw error: {stderr}",
                file=sys.stderr,
            )
        else:
            print(
                f"ERROR [{name}]: camera.snapshot service call failed.\n"
                f"  Entity: {entity_id}\n"
                f"  Target path: {ha_filepath}\n"
                f"  hass-cli stderr: {stderr}\n"
                f"  hass-cli stdout: {result.stdout.strip()}",
                file=sys.stderr,
            )
        return None

    # Give HA a moment to finish writing the file to disk
    time.sleep(SNAPSHOT_WRITE_DELAY)

    # -- Step 2: Download the snapshot from HA's /local/ URL --
    download_url = f"{HASS_SERVER}/local/openclaw/{ha_filename}"
    try:
        result = subprocess.run(
            [
                "curl", "-sf",
                "--max-time", "15",
                "-o", local_filepath,
                "-H", f"Authorization: Bearer {HASS_TOKEN}",
                download_url,
            ],
            capture_output=True,
            text=True,
            timeout=20,
        )
    except subprocess.TimeoutExpired:
        print(
            f"ERROR [{name}]: curl timed out downloading from {download_url}. "
            f"Is Home Assistant reachable at {HASS_SERVER}?",
            file=sys.stderr,
        )
        return None

    if result.returncode != 0:
        # curl -f returns 22 for HTTP errors (4xx/5xx)
        if result.returncode == 22:
            print(
                f"ERROR [{name}]: HTTP error downloading snapshot.\n"
                f"  URL: {download_url}\n"
                f"  This usually means the snapshot file doesn't exist on HA.\n"
                f"  Verify:\n"
                f"    • camera.snapshot succeeded (check HA logs)\n"
                f"    • {HA_SNAP_DIR}/ directory exists on the HA server\n"
                f"    • The /local/ path mapping is working in HA",
                file=sys.stderr,
            )
        elif result.returncode == 7:
            print(
                f"ERROR [{name}]: Could not connect to {HASS_SERVER}. "
                f"Is Home Assistant running?",
                file=sys.stderr,
            )
        else:
            print(
                f"ERROR [{name}]: curl failed with exit code {result.returncode}.\n"
                f"  URL: {download_url}\n"
                f"  stderr: {result.stderr.strip()}",
                file=sys.stderr,
            )
        # Clean up any partial download
        if os.path.exists(local_filepath):
            os.remove(local_filepath)
        return None

    # Validate the downloaded file
    if not os.path.exists(local_filepath):
        print(
            f"ERROR [{name}]: curl reported success but file not found "
            f"at {local_filepath}",
            file=sys.stderr,
        )
        return None

    file_size = os.path.getsize(local_filepath)
    if file_size == 0:
        print(
            f"ERROR [{name}]: downloaded file is 0 bytes. "
            f"The snapshot on HA may be empty or the URL may have returned "
            f"an empty response.\n"
            f"  URL: {download_url}",
            file=sys.stderr,
        )
        os.remove(local_filepath)
        return None

    # JPEG files start with bytes FF D8
    with open(local_filepath, "rb") as f:
        header = f.read(2)
    if header != b"\xff\xd8":
        print(
            f"ERROR [{name}]: downloaded file is not a valid JPEG "
            f"(got header {header.hex()} instead of ffd8). "
            f"HA may have returned an error page instead of an image.\n"
            f"  URL: {download_url}\n"
            f"  File size: {file_size} bytes",
            file=sys.stderr,
        )
        os.remove(local_filepath)
        return None

    size_kb = file_size / 1024
    print(f"{local_filepath} ({size_kb:.0f} KB)")
    return local_filepath


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        print("Usage: snapshot.py <camera-name|all|--list>")
        print()
        print("Cameras:")
        for name in CAMERAS:
            print(f"  {name}")
        print(f"  all  (capture every camera)")
        print()
        print("Options:")
        print("  --list   Show camera name → entity_id mapping")
        sys.exit(0)

    arg = sys.argv[1]

    # List mode — just print the mapping and exit
    if arg == "--list":
        for name, entity in CAMERAS.items():
            print(f"  {name:30s} → {entity}")
        sys.exit(0)

    # Run pre-flight checks before doing any real work
    errors = preflight()
    if errors:
        print("Pre-flight check failed:", file=sys.stderr)
        for err in errors:
            print(f"  ✗ {err}", file=sys.stderr)
        sys.exit(1)

    # Figure out which cameras to capture
    if arg == "all":
        targets = list(CAMERAS.items())
    elif arg in CAMERAS:
        targets = [(arg, CAMERAS[arg])]
    else:
        print(f"Unknown camera: '{arg}'", file=sys.stderr)
        print(f"Available cameras: {', '.join(CAMERAS.keys())}, all",
              file=sys.stderr)
        sys.exit(1)

    # Capture each target, tracking successes and failures
    succeeded = []
    failed = []
    for name, entity_id in targets:
        path = snapshot(name, entity_id)
        if path:
            succeeded.append(path)
        else:
            failed.append(name)

    # Summary
    print()
    if succeeded:
        print(f"✓ {len(succeeded)} snapshot(s) saved to {CAPTURE_DIR}/")
    if failed:
        print(
            f"✗ {len(failed)} snapshot(s) failed: {', '.join(failed)}",
            file=sys.stderr,
        )

    # Exit with error if anything failed
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
