# 🦞❤️🐙 OpenClaw Hub

[![CI Tests](https://github.com/JeffSteinbok/openclaw-hub/actions/workflows/ci-tests.yml/badge.svg)](https://github.com/JeffSteinbok/openclaw-hub/actions/workflows/ci-tests.yml)
[![Build Docs Satellite Bundle](https://github.com/JeffSteinbok/openclaw-hub/actions/workflows/docs-satellite-bundle.yml/badge.svg)](https://github.com/JeffSteinbok/openclaw-hub/actions/workflows/docs-satellite-bundle.yml)

Public plugins, services, and shared libraries for [OpenClaw](https://jeffsteinbok.github.io/octo-docs/). This repo contains the public pieces I use in my own assistant.

**Contents:** [Using](#using) · [Plugins](#plugins) · [Mail Runtime](#mail-runtime) · [Development](#development)

---

## Using

Clone or download this repo, then install plugins:

```bash
openclaw plugin install ./plugins/spotify
openclaw plugin install ./plugins/homeassistant
```

This registers them in `~/.openclaw/plugins/installs.json`. You can also use `file:` references in `openclaw.json`:

```json
{
  "plugins": [
    "file:./path/to/openclaw-hub/plugins/spotify",
    "file:./path/to/openclaw-hub/plugins/glances"
  ]
}
```

Services like `fastmail-sse` run as separate processes (typically systemd user services) — see each service's README.

---

## Plugins

All plugins can also be used as **standalone CLI tools** — no gateway required. Run `npm run build` in any plugin directory to generate a CLI at `dist/bin/<name>.js`. See [plugins/README.md](plugins/README.md#cli-generation) for details.

| | Plugin | Description |
|---|--------|-------------|
| ✉️ | [Fastmail](plugins/fastmail/) | Send/search/read mail, work with calendars |
| 📊 | [Glances](plugins/glances/) | Live CPU, memory, disk metrics from a Glances server |
| 🏠 | [Home Assistant](plugins/homeassistant/) | Control devices, query state, inspect activity |
| 📄 | [HTML to PDF](plugins/html-to-pdf/) | Convert HTML files to PDF via Chromium headless |
| 📅 | [ICS Calendar](plugins/ics-calendar/) | Read events from ICS feeds |
| 👁️ | [LLMVision](plugins/llmvision/) | Image analysis workflows |
| 📝 | [Markdown to HTML](plugins/md-to-html/) | Convert extended Markdown to styled HTML |
| 📆 | [Outlook Calendar](plugins/outlook-calendar/) | Query Outlook calendar data |
| 📬 | [Outlook Mail](plugins/outlook-mail/) | Search and read Outlook mail |
| 🗓️ | [Outlook Work Calendar](plugins/outlook-work-calendar/) | Work-focused Outlook calendar |
| 📦 | [Package Tracking](plugins/package-tracking/) | Track any package by carrier + number; auto-detect from email for UPS, FedEx, USPS |
| 🎵 | [Spotify](plugins/spotify/) | Playback control and search |
| 📈 | [Stock Quotes](plugins/stock-quotes/) | Quick stock quote lookups |
| 📮 | [USPS Mail](plugins/usps-mail/) | Operator-facing USPS Informed Delivery tools |
| ❤️ | [Withings](plugins/withings/) | Health metrics from Withings devices |

Plugin conventions: [`PLUGIN_README_SHAPE.md`](PLUGIN_README_SHAPE.md)

---

## Mail Runtime

A shared, provider-agnostic **mail automation layer**. Incoming mail is normalized into a `MailEnvelope`, matched against declarative rules, and dispatched to named actions that return structured results.

| Component | Purpose |
|-----------|---------|
| 🧠 [Mail Runtime Core](libs/ts/mail_runtime_core/) | Rule engine, action registry, result dispatch |
| 📮 [USPS Mail Action](libs/ts/mail_action_usps/) | USPS Informed Delivery digest processing |
| 📦 [Package Tracking Core](libs/ts/package_tracking_core/) | Carrier detection, tracking URLs, storage |
| ⚡ [FastMail SSE](services/fastmail-sse/) | Live FastMail listener that feeds the runtime |

**Built-in actions:** `notify_email` · `detect_tracking` · `process_usps_digest`

The runtime is pluggable — you can register custom actions. See [Mail Runtime Core](libs/ts/mail_runtime_core/) for the action plugin interface.

---

## Development

See [`DEVELOPMENT.md`](DEVELOPMENT.md) for build instructions, project structure, and how to add new plugins or mail actions.
