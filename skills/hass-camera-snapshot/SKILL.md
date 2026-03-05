name: hass-camera-snapshot
description: Take a snapshot from any home security camera via Home Assistant CLI. Use this whenever the user asks to see a camera, check a camera, take a snapshot, or look at what's happening at home. Do NOT use nodes, camera.snap, or UniFi APIs — this skill handles everything.

## Usage

```bash
python3 skills/hass-camera-snapshot/scripts/snapshot.py <camera-name>
```

## Camera Names

- `living-room`
- `front-doorbell`
- `front-doorbell-package` (package camera)
- `backyard-right`
- `backyard-left`
- `driveway`
- `family-room`
- `garage`
- `all` (snapshot all cameras)

## Examples

```bash
# Single camera
python3 skills/hass-camera-snapshot/scripts/snapshot.py front-doorbell

# All cameras
python3 skills/hass-camera-snapshot/scripts/snapshot.py all

# List available cameras
python3 skills/hass-camera-snapshot/scripts/snapshot.py --list
```

Output: prints the saved file path(s). Images are saved to `~/.openclaw/agents/main/workspace/camera_captures/`.

## How It Works

1. Calls `camera.snapshot` service via hass-cli to save image on the HA device
2. Downloads the image from HA to the local camera_captures directory
3. Deletes the temporary snapshot from the HA device

## HA Setup Requirements

On the Home Assistant device, add to `configuration.yaml`:

```yaml
homeassistant:
  allowlist_external_dirs:
    - "/config/www/openclaw"

shell_command:
  openclaw_cleanup: "rm -f /config/www/openclaw/snap_*.jpg"
```

Then create the directory: `mkdir -p /config/www/openclaw`

Restart Home Assistant after these changes.
