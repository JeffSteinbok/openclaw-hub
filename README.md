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

| | Plugin | Description | Docs |
|---|--------|-------------|------|
| ✉️ | Fastmail | Send/search/read mail, work with calendars | [README](plugins/fastmail/README.md) |
| 📊 | Glances | Live CPU, memory, disk metrics from a Glances server | [README](plugins/glances/README.md) |
| 🏠 | Home Assistant | Control devices, query state, inspect activity | [README](plugins/homeassistant/README.md) |
| 📄 | HTML to PDF | Convert HTML files to PDF via Chromium headless | [README](plugins/html-to-pdf/README.md) |
| 📅 | ICS Calendar | Read events from ICS feeds | [README](plugins/ics-calendar/README.md) |
| 👁️ | LLMVision | Image analysis workflows | [README](plugins/llmvision/README.md) |
| 📆 | Outlook Calendar | Query Outlook calendar data | [README](plugins/outlook-calendar/README.md) |
| 📬 | Outlook Mail | Search and read Outlook mail | [README](plugins/outlook-mail/README.md) |
| 🗓️ | Outlook Work Calendar | Work-focused Outlook calendar | [README](plugins/outlook-work-calendar/README.md) |
| 📦 | Package Tracking | Track packages (UPS, FedEx, USPS, Amazon) | [README](plugins/package-tracking/README.md) |
| 🎵 | Spotify | Playback control and search | [README](plugins/spotify/README.md) |
| 📈 | Stock Quotes | Quick stock quote lookups | [README](plugins/stock-quotes/README.md) |
| 📮 | USPS Mail | Operator-facing USPS Informed Delivery tools | [README](plugins/usps-mail/README.md) |
| ❤️ | Withings | Health metrics from Withings devices | [README](plugins/withings/README.md) |

Plugin conventions: [`PLUGIN_README_SHAPE.md`](PLUGIN_README_SHAPE.md)

---

## Mail Runtime

A shared, provider-agnostic **mail automation layer**. Incoming mail is normalized into a `MailEnvelope`, matched against declarative rules, and dispatched to named actions that return structured results.

| Component | Purpose | Docs |
|-----------|---------|------|
| 🧠 Mail Runtime Core | Rule engine, action registry, result dispatch | [README](libs/ts/mail_runtime_core/README.md) |
| 📮 USPS Mail Action | USPS Informed Delivery digest processing | [README](libs/ts/mail_action_usps/README.md) |
| 📦 Package Tracking Core | Carrier detection, tracking URLs, storage | [README](libs/ts/package_tracking_core/README.md) |
| ⚡ FastMail SSE | Live FastMail listener that feeds the runtime | [README](services/fastmail-sse/README.md) |

**Built-in actions:** `notify_email` · `detect_tracking` · `process_usps_digest`

The runtime is pluggable — you can register custom actions. See the [mail runtime core README](libs/ts/mail_runtime_core/README.md) for the action plugin interface.

---

## Development

See [`DEVELOPMENT.md`](DEVELOPMENT.md) for build instructions, project structure, and how to add new plugins or mail actions.
