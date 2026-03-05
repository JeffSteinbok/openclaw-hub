# hass-camera-snapshot

Take snapshots from home security cameras via Home Assistant CLI. Designed as an OpenClaw skill — the agent calls the script, gets back local image paths.

## How It Works

1. Calls `camera.snapshot` via `hass-cli` to save a JPEG on the HA server (`/config/www/openclaw/snap_<camera>.jpg`)
2. Downloads the image over HTTP from HA's `/local/` URL to a local `camera_captures/` directory with a timestamped filename
3. One fixed file per camera on HA (overwritten each call) to avoid filling up HA storage; timestamped copies kept locally

## Prerequisites

### On this machine (OpenClaw host)

- **Python 3.8+**
- **hass-cli** — `pip install homeassistant-cli`
- **curl**
- **Environment variables** (typically set in `~/.bashrc`):
  - `HASS_SERVER` — HA base URL (e.g. `http://192.168.1.76:8123`)
  - `HASS_TOKEN` — Long-lived access token from HA

### On the Home Assistant server

1. **Create the snapshot directory:**
   ```bash
   mkdir -p /config/www/openclaw
   ```

2. **Allowlist the directory** in `configuration.yaml`:
   ```yaml
   homeassistant:
     allowlist_external_dirs:
       - "/config/www/openclaw"
   ```

3. **Restart Home Assistant** after editing `configuration.yaml`.

### Verify prerequisites

The script runs pre-flight checks automatically. If something is missing, it tells you exactly what and how to fix it.

## Usage

```bash
# Take a single snapshot
python3 scripts/snapshot.py driveway

# Take all cameras
python3 scripts/snapshot.py all

# List available cameras and their HA entity IDs
python3 scripts/snapshot.py --list

# Help
python3 scripts/snapshot.py --help
```

## Available Cameras

| Friendly Name           | HA Entity ID |
|-------------------------|-------------|
| `living-room`           | `camera.living_room_camera_high_resolution_channel` |
| `front-doorbell`        | `camera.front_doorbell_camera_high_resolution_channel` |
| `front-doorbell-package`| `camera.front_doorbell_camera_package_camera` |
| `backyard-right`        | `camera.backyard_right_camera_high_resolution_channel` |
| `backyard-left`         | `camera.backyard_left_camera_high_resolution_channel_2` |
| `driveway`              | `camera.driveway_camera_high_resolution_channel` |
| `family-room`           | `camera.family_room_camera_high_resolution_channel` |
| `garage`                | `camera.garage_camera_high_resolution_channel` |

## Testing

**1. Quick check — pre-flight only (no HA call):**
```bash
# Unset HASS_TOKEN temporarily to see the pre-flight error
HASS_TOKEN= python3 scripts/snapshot.py driveway
# Expected: "Pre-flight check failed: ✗ HASS_TOKEN is not set..."
```

**2. Single camera test:**
```bash
python3 scripts/snapshot.py driveway
# Expected: /path/to/camera_captures/driveway_20260304_120000.jpg (XX KB)
```

**3. All cameras test:**
```bash
python3 scripts/snapshot.py all
# Expected: ✓ 8 snapshot(s) saved to .../camera_captures/
```

**4. Verify the image is valid:**
```bash
file camera_captures/driveway_*.jpg
# Expected: JPEG image data, ...
```

## Error Messages

The script produces specific, actionable errors:

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `HA returned 500` | `/config/www/openclaw/` doesn't exist or isn't allowlisted | Create dir on HA + add to `allowlist_external_dirs` |
| `HA authentication failed` | Token expired or invalid | Generate a new long-lived token in HA UI |
| `Could not connect to HASS_SERVER` | HA is down or unreachable | Check HA is running, check network |
| `HTTP error downloading snapshot` | File not written to HA's www dir | Check HA logs for camera.snapshot errors |
| `Not a valid JPEG` | HA returned an error page instead of an image | Check the download URL manually in a browser |

## Output

- **Snapshots saved to:** `~/.openclaw/agents/main/workspace/camera_captures/`
- **Filename format:** `<camera-name>_<YYYYMMDD_HHMMSS>.jpg`
- **Exit code 0** = all snapshots succeeded
- **Exit code 1** = at least one snapshot failed (details on stderr)

## Adding a New Camera

Edit `CAMERAS` dict in `scripts/snapshot.py`:

```python
CAMERAS = {
    ...
    "new-camera": "camera.new_camera_entity_id",
}
```

Find entity IDs with: `hass-cli state list | grep camera.`
