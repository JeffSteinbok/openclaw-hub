# 🦞❤️🐙 OpenClaw Hub

[![CI Tests](https://github.com/JeffSteinbok/openclaw-hub/actions/workflows/ci-tests.yml/badge.svg)](https://github.com/JeffSteinbok/openclaw-hub/actions/workflows/ci-tests.yml)
[![Build Docs Satellite Bundle](https://github.com/JeffSteinbok/openclaw-hub/actions/workflows/docs-satellite-bundle.yml/badge.svg)](https://github.com/JeffSteinbok/openclaw-hub/actions/workflows/docs-satellite-bundle.yml)

Public plugins, services, and shared libraries for use in OpenClaw.

This repo contains the public pieces I use in my own assistant. If you want the broader docs and examples for that assistant, start with [`octo-docs`](https://jeffsteinbok.github.io/octo-docs/).

## Table of Contents

- [Using](#using-)
- [Mail Runtime](#mail-runtime-)
- [Independent Plugins](#independent-plugins-%EF%B8%8F)
- [Shared Libraries](#shared-libraries-)
- [Contributing](#contributing-)

---

## Using 🚀

### Installing plugins

Download or clone this repo, then install plugins into OpenClaw:

```bash
openclaw plugin install ./plugins/spotify
openclaw plugin install ./plugins/homeassistant
```

This registers each plugin in `~/.openclaw/plugins/installs.json`. You can also reference plugin directories directly in your `openclaw.json`:

```json
{
  "plugins": [
    "file:./path/to/openclaw-hub/plugins/spotify",
    "file:./path/to/openclaw-hub/plugins/glances"
  ]
}
```

### Shared libraries

The shared libraries under `libs/ts/` are consumed as npm `file:` dependencies by plugins and services that need them. You don't install these directly — they're resolved automatically when you build from the workspace.

### Services

Services like `fastmail-sse` run as separate long-lived processes, typically managed via systemd user services. See each service's README for setup instructions.

---

## Mail Runtime 📬

The **Mail Runtime** is the part of this repo that turns incoming email into useful OpenClaw actions.

It is meant for workflows like:

- notifying you when an important email arrives
- detecting package tracking numbers from shipping emails
- processing USPS Informed Delivery digests
- handing off structured results for follow-up or memory

### What it does

At a high level, the mail runtime:

1. receives a message from some mail source
2. checks that message against your mail rules
3. runs one or more named actions
4. returns structured results such as notifications, tracking updates, or follow-up work

The important thing for a reader is that this gives OpenClaw a reusable **mail automation layer**, instead of each mail integration inventing its own separate logic.

### Main pieces 🧩

| Piece | What it is | Details |
| --- | --- | --- |
| 🧠 Mail Runtime Core | The shared rule-and-action engine for mail processing | [`libs/ts/mail_runtime_core/README.md`](libs/ts/mail_runtime_core/README.md) |
| 📮 USPS Mail Action | The USPS-specific workflow used for Informed Delivery digests | [`libs/ts/mail_action_usps/README.md`](libs/ts/mail_action_usps/README.md) |
| ⚡ FastMail SSE | A live FastMail listener that feeds new mail into the runtime | [`services/fastmail-sse/README.md`](services/fastmail-sse/README.md) |
| 📦 Package Tracking Core | Shared tracking logic used when mail contains shipment updates | [`libs/ts/package_tracking_core/README.md`](libs/ts/package_tracking_core/README.md) |

### Actions you should know about 🎯

| Action | What it means |
| --- | --- |
| `notify_email` | 🔔 Send a notification for a matching message |
| `detect_tracking` | 📦 Look for package tracking data in email |
| `process_usps_digest` | 📮 Process a USPS Informed Delivery digest end to end |

### FastMail SSE ⚡

**FastMail SSE** watches FastMail in real time, turns new messages into the shared mail format, and passes them into the runtime. If the mail runtime is the shared automation brain, FastMail SSE is one of the live inputs that feeds it.

See [`services/fastmail-sse/README.md`](services/fastmail-sse/README.md) for details.

### Interactive companions 🛠️

| Component | What it is | Details |
| --- | --- | --- |
| 📦 `package-tracking` plugin | A direct OpenClaw tool surface for package tracking | [`plugins/package-tracking/README.md`](plugins/package-tracking/README.md) |
| 📮 `usps-mail` plugin | A manual/operator-facing tool surface for the USPS workflow | [`plugins/usps-mail/README.md`](plugins/usps-mail/README.md) |

---

## Independent Plugins 🎛️

Stand-alone OpenClaw plugins — not part of the mail runtime. Browse and use individually.

Plugin README conventions live in [`PLUGIN_README_SHAPE.md`](PLUGIN_README_SHAPE.md).

| Plugin | What it is | Details |
| --- | --- | --- |
| ✉️ Fastmail | Send mail, search mail, read inbox items, and work with calendars | [`plugins/fastmail/README.md`](plugins/fastmail/README.md) |
| 📊 Glances | Read live CPU, memory, disk, and summary metrics from a Glances server | [`plugins/glances/README.md`](plugins/glances/README.md) |
| 🏠 Home Assistant | Control Home Assistant from OpenClaw | [`plugins/homeassistant/README.md`](plugins/homeassistant/README.md) |
| 📄 HTML to PDF | Convert HTML files to PDF using Chromium headless | [`plugins/html-to-pdf/README.md`](plugins/html-to-pdf/README.md) |
| 📅 ICS Calendar | Read calendar data from ICS feeds | [`plugins/ics-calendar/README.md`](plugins/ics-calendar/README.md) |
| 👁️ LLMVision | Vision-oriented tooling for image analysis workflows | [`plugins/llmvision/README.md`](plugins/llmvision/README.md) |
| 📆 Outlook Calendar | Query Outlook calendar data | [`plugins/outlook-calendar/README.md`](plugins/outlook-calendar/README.md) |
| 📬 Outlook Mail | Search and read Outlook mail | [`plugins/outlook-mail/README.md`](plugins/outlook-mail/README.md) |
| 🗓️ Outlook Work Calendar | A work-focused Outlook calendar surface | [`plugins/outlook-work-calendar/README.md`](plugins/outlook-work-calendar/README.md) |
| 🎵 Spotify | Spotify control and playback tooling | [`plugins/spotify/README.md`](plugins/spotify/README.md) |
| 📈 Stock Quotes | Quick stock quote lookups | [`plugins/stock-quotes/README.md`](plugins/stock-quotes/README.md) |
| ❤️ Withings | Read health metrics from Withings devices and services | [`plugins/withings/README.md`](plugins/withings/README.md) |

---

## Shared Libraries 🧰

Shared TypeScript libraries consumed by plugins and services:

| Library | Purpose | Details |
| --- | --- | --- |
| `mail_runtime_core` | Rule engine, action registry, result dispatch | [`libs/ts/mail_runtime_core`](libs/ts/mail_runtime_core) |
| `mail_action_usps` | USPS digest parsing, vision analysis, memory | [`libs/ts/mail_action_usps`](libs/ts/mail_action_usps) |
| `package_tracking_core` | Carrier detection, tracking URLs, package storage | [`libs/ts/package_tracking_core`](libs/ts/package_tracking_core) |

See [`libs/README.md`](libs/README.md) for architecture details.

---

## Contributing 🔌

All plugins are pure TypeScript and follow a consistent adapter pattern. See [`plugins/README.md`](plugins/README.md) for the architecture guide and [`DEVELOPMENT.md`](DEVELOPMENT.md) for build instructions, project structure, and how to add new plugins or mail actions.
