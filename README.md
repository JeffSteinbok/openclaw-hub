# 🐙 openclaw-hub

Custom skills and services for **Octo** — my personal [OpenClaw](https://openclaw.ai) assistant.

## What's Here

### Skills

Skills are agent capabilities that Octo can invoke. They're symlinked into the OpenClaw workspace at `~/.openclaw/agents/main/workspace/skills/`.

| Skill | Description |
|-------|-------------|
| [hass-camera-snapshot](skills/hass-camera-snapshot/) | Take snapshots from home security cameras via Home Assistant CLI |
| [opentable](skills/opentable/) | Check real-time restaurant availability on OpenTable |

### Services

Long-running background services that support Octo, managed via systemd.

| Service | Description |
|---------|-------------|
| [fastmail-sse](services/fastmail-sse/) | JMAP EventSource client for real-time email notifications |

## Setup

Skills are symlinked from this repo into the OpenClaw workspace:

```bash
ln -s ~/git/openclaw-hub/skills/opentable ~/.openclaw/agents/main/workspace/skills/opentable
ln -s ~/git/openclaw-hub/skills/hass-camera-snapshot ~/.openclaw/agents/main/workspace/skills/hass-camera-snapshot
```

Services are installed as systemd user units:

```bash
cp services/fastmail-sse/fastmail-sse.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now fastmail-sse
```

## Adding a New Skill

1. Create a directory under `skills/` with a `SKILL.md` and optional `scripts/`
2. Symlink it into the workspace
3. Restart the gateway or wait for the next session

## Adding a New Service

1. Create a directory under `services/` with the script and a `.service` file
2. Install the unit and enable it via systemd
