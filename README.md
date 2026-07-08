# 🦞❤️🐙 OpenClaw Hub

[![CI Tests](https://github.com/JeffSteinbok/openclaw-hub/actions/workflows/ci-tests.yml/badge.svg)](https://github.com/JeffSteinbok/openclaw-hub/actions/workflows/ci-tests.yml)

Public plugins, CLIs, services, and shared libraries for [OpenClaw](https://jeffsteinbok.github.io/octo-docs/). This repo contains the public pieces I use in my own assistant.

> **Building a new plugin?** Use [carapace-plugin-template](https://github.com/JeffSteinbok/carapace-plugin-template) to scaffold it as a standalone repo with the [Carapace Plugin SDK](https://github.com/JeffSteinbok/carapace-plugin-sdk).

---

## Plugins

| | Plugin | Description |
|---|--------|-------------|
| ✉️ | [Fastmail](plugins/fastmail/) | Send/search/read mail, work with calendars |
| 📊 | [Glances](plugins/glances/) | Live CPU, memory, disk metrics from a Glances server |
| 📚 | [Goodreads](plugins/goodreads/) | Search books and read your shelves via a headless browser |
| 🏠 | [Home Assistant](plugins/homeassistant/) | Control devices, query state, inspect activity |
| 📄 | [HTML to PDF](plugins/html-to-pdf/) | Convert HTML files to PDF via Chromium headless |
| 📅 | [ICS Calendar](plugins/ics-calendar/) | Read events from ICS feeds |
| 👁️ | [LLMVision](plugins/llmvision/) | Image analysis workflows |
| 📝 | [Markdown to HTML](plugins/md-to-html/) | Convert extended Markdown to styled HTML |
| 🗂️ | [Obsidian Vault](https://github.com/JeffSteinbok/carapace-obsidian) | Read-only access to an Obsidian vault — search, read, and explore notes *(standalone repo)* |
| 🛰️ | [Octo Satellite](plugins/octo-satellite/) | Remote agent for running plugins on secondary machines |
| 📆 | [Outlook Calendar](plugins/outlook-calendar/) | Query Outlook calendar data |
| 📬 | [Outlook Mail](plugins/outlook-mail/) | Search and read Outlook mail |
| 🗓️ | [Outlook Work Calendar](plugins/outlook-work-calendar/) | Work-focused Outlook calendar |
| 📸 | [Screenshot Capture](plugins/screenshot-capture/) | Capture screenshots from paired nodes, write to media store |
| 🎵 | [Spotify](plugins/spotify/) | Playback control and search |
| 📮 | [USPS Mail](plugins/usps-mail/) | Operator-facing USPS Informed Delivery tools |
| ⚖️ | [WeightWatchers](plugins/weightwatchers/) | WeightWatchers points and meal tracking |
| ❤️ | [Withings](plugins/withings/) | Health metrics from Withings devices |

All plugins use the [Carapace Plugin SDK](https://github.com/JeffSteinbok/carapace-plugin-sdk) for CLI generation.

---

## CLIs

Lightweight command-line tools the agent runs as subprocesses. See [`clis/`](clis/) for when to use a CLI vs. a plugin.

| CLI | Description |
|-----|-------------|
| ⏳ [`waitlistme`](clis/waitlistme/) | Add yourself to a [Waitlist.me](https://www.waitlist.me) queue |

---

## Services & Libraries

| Component | Purpose |
|-----------|---------|
| 📮 [USPS Mail Action](libs/ts/mail_action_usps/) | USPS Informed Delivery digest processing |
| ⚡ [FastMail SSE](services/fastmail-sse/) | Live FastMail listener that feeds the mail runtime |

---

## Documentation

| Doc | Contents |
|-----|----------|
| [`DEVELOPMENT.md`](DEVELOPMENT.md) | Build instructions and project structure |
| [`TOOLS.md`](TOOLS.md) | Registry of tools the agent can call |
| [`CHANGELOG.md`](CHANGELOG.md) | Notable changes over time |
| [`SECURITY.md`](SECURITY.md) | Security policy and reporting |
