# 🐙 openclaw-hub

Custom skills and services for **Octo** — my personal [OpenClaw](https://openclaw.ai) assistant.

## What's Here

### Skills

Skills are agent capabilities that Octo can invoke. They're symlinked into the OpenClaw workspace at `~/.openclaw/agents/main/workspace/skills/`.

| Skill | Description |
|-------|-------------|
| [fastmail-send](skills/fastmail-send/) | Send email and meeting requests (with accept/decline) via Fastmail JMAP |
| [hass-camera-snapshot](skills/hass-camera-snapshot/) | Take snapshots from home security cameras via Home Assistant CLI |
| [opentable](skills/opentable/) | Check real-time restaurant availability on OpenTable |

### Services

Long-running background services that support Octo, managed via systemd.

| Service | Description |
|---------|-------------|
| [fastmail-sse](services/fastmail-sse/) | JMAP EventSource client for real-time email notifications |
