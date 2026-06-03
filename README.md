# 🦞❤️🐙 OpenClaw Hub

[![CI Tests](https://github.com/JeffSteinbok/openclaw-hub/actions/workflows/ci-tests.yml/badge.svg)](https://github.com/JeffSteinbok/openclaw-hub/actions/workflows/ci-tests.yml)

Public plugins, services, and shared libraries for [OpenClaw](https://jeffsteinbok.github.io/octo-docs/). This repo contains the public pieces I use in my own assistant.

> **Building a new plugin?** Use [carapace-plugin-template](https://github.com/JeffSteinbok/carapace-plugin-template) to scaffold it as a standalone repo with the [Carapace Plugin SDK](https://github.com/JeffSteinbok/carapace-plugin-sdk).

---

## Plugins

| | Plugin | Description |
|---|--------|-------------|
| ✉️ | [Fastmail](plugins/fastmail/) | Send/search/read mail, work with calendars |
| 📊 | [Glances](plugins/glances/) | Live CPU, memory, disk metrics from a Glances server |
| 🏠 | [Home Assistant](plugins/homeassistant/) | Control devices, query state, inspect activity |
| 📄 | [HTML to PDF](plugins/html-to-pdf/) | Convert HTML files to PDF via Chromium headless |
| 📅 | [ICS Calendar](plugins/ics-calendar/) | Read events from ICS feeds |
| 👁️ | [LLMVision](plugins/llmvision/) | Image analysis workflows |
| 📝 | [Markdown to HTML](plugins/md-to-html/) | Convert extended Markdown to styled HTML |
| 🗂️ | [Obsidian Vault](plugins/obsidian-vault/) | Read-only access to an Obsidian vault — search, read, and explore notes |
| 🛰️ | [Octo Satellite](plugins/octo-satellite/) | Remote agent for running plugins on secondary machines |
| 🍽️ | [OpenTable](plugins/opentable/) | Check restaurant availability and make reservations |
| 📆 | [Outlook Calendar](plugins/outlook-calendar/) | Query Outlook calendar data |
| 📬 | [Outlook Mail](plugins/outlook-mail/) | Search and read Outlook mail |
| 🗓️ | [Outlook Work Calendar](plugins/outlook-work-calendar/) | Work-focused Outlook calendar |
| 📦 | [Package Tracking](plugins/package-tracking/) | Carrier detection, tracking URL generation, package storage |
| 🖨️ | [Printing Press](plugins/printing-press/) | Expose Printing Press CLI tools as OpenClaw tools |
| 🎵 | [Spotify](plugins/spotify/) | Playback control and search |
| 📈 | [Stock Quotes](plugins/stock-quotes/) | Get quotes for stocks, ETFs, and mutual funds |
| 📮 | [USPS Mail](plugins/usps-mail/) | Operator-facing USPS Informed Delivery tools |
| 🥗 | [WeightWatchers](plugins/weightwatchers/) | Search foods, log meals, view diary and points budget |
| ❤️ | [Withings](plugins/withings/) | Health metrics from Withings devices |

All plugins use the [Carapace Plugin SDK](https://github.com/JeffSteinbok/carapace-plugin-sdk) for CLI generation.

---

## Mail Runtime

| Component | Purpose |
|-----------|---------|
| 📮 [USPS Mail Action](libs/ts/mail_action_usps/) | USPS Informed Delivery digest processing |
| ⚡ [FastMail SSE](services/fastmail-sse/) | Live FastMail listener that feeds the runtime |

---

## Development

See [`DEVELOPMENT.md`](DEVELOPMENT.md) for build instructions and project structure.
