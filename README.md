# OpenClaw Hub

[![CI Tests](https://github.com/JeffSteinbok/openclaw-hub/actions/workflows/ci-tests.yml/badge.svg)](https://github.com/JeffSteinbok/openclaw-hub/actions/workflows/ci-tests.yml)
[![Build Docs Satellite Bundle](https://github.com/JeffSteinbok/openclaw-hub/actions/workflows/docs-satellite-bundle.yml/badge.svg)](https://github.com/JeffSteinbok/openclaw-hub/actions/workflows/docs-satellite-bundle.yml)

Public plugins, services, and shared libraries for use in OpenClaw.

This repo contains the public pieces I use in my own assistant. If you want the broader docs and examples for that assistant, start with [`octo-docs`](https://jeffsteinbok.github.io/octo-docs/).

## What's in here? ✨

There are two main kinds of things here:

1. a **shared mail runtime** for automated email handling
2. a set of **stand-alone plugins** for other OpenClaw tasks

If you only want the quick summary: the mail runtime is the most integrated system in this repo, and the rest are individual plugins you can browse and use on their own.

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
| 🧠 Mail Runtime Core | The shared rule-and-action engine for mail processing | [`libs/python/mail_runtime_core/README.md`](libs/python/mail_runtime_core/README.md) |
| 📮 USPS Mail Action | The USPS-specific workflow used for Informed Delivery digests | [`libs/python/mail_action_usps/README.md`](libs/python/mail_action_usps/README.md) |
| ⚡ FastMail SSE | A live FastMail listener that feeds new mail into the runtime | [`services/fastmail-sse/README.md`](services/fastmail-sse/README.md) |
| 📦 Package Tracking Core | Shared tracking logic used when mail contains shipment updates | [`libs/python/package_tracking_core/README.md`](libs/python/package_tracking_core/README.md) |

### Actions you should know about 🎯

These are the main actions exposed through the mail runtime:

| Action | What it means |
| --- | --- |
| `notify_email` | 🔔 Send a notification for a matching message |
| `detect_tracking` | 📦 Look for package tracking data in email |
| `process_usps_digest` | 📮 Process a USPS Informed Delivery digest end to end |

### FastMail SSE ⚡

**FastMail SSE** is one of the ways to use the mail runtime in practice.

It watches FastMail in real time, turns new messages into the shared mail format, and passes them into the runtime. In other words: if the mail runtime is the shared automation brain, FastMail SSE is one of the live inputs that feeds it.

See [`services/fastmail-sse/README.md`](services/fastmail-sse/README.md) for the FastMail-specific details.

### Interactive companions 🛠️

These pieces sit next to the mail runtime and make it easier to use or inspect:

| Component | What it is | Details |
| --- | --- | --- |
| 📦 `package-tracking` plugin | A direct OpenClaw tool surface for package tracking | [`plugins/package-tracking/README.md`](plugins/package-tracking/README.md) |
| 📮 `usps-mail` plugin | A manual/operator-facing tool surface for the USPS workflow | [`plugins/usps-mail/README.md`](plugins/usps-mail/README.md) |

## Independent Plugins 🎛️

The rest of the repo is made up of more independent plugins. These are not the shared mail runtime; they are separate OpenClaw capabilities you can look at one by one.

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

## Shared Libraries 🧰

Shared TypeScript libraries consumed by plugins and services:

| Library | Purpose | Details |
| --- | --- | --- |
| `mail_runtime_core` | Rule engine, action registry, result dispatch | [`libs/ts/mail_runtime_core`](libs/ts/mail_runtime_core) |
| `mail_action_usps` | USPS digest parsing, vision analysis, memory | [`libs/ts/mail_action_usps`](libs/ts/mail_action_usps) |
| `package_tracking_core` | Carrier detection, tracking URLs, package storage | [`libs/ts/package_tracking_core`](libs/ts/package_tracking_core) |

See [`libs/README.md`](libs/README.md) for architecture details.

## Plugin Architecture 🔌

All plugins are pure TypeScript and follow a consistent adapter pattern. See [`plugins/README.md`](plugins/README.md) for the full architecture guide, including required files and checklist for new plugins.

## Downloading 📦

Download the **whole release bundle** from the latest GitHub release.

This repo is small enough that it is easier to ship one bundle containing the exported public components than to make people choose from a long list of separate downloads.

## Building locally 🛠️

1. Run `npm install`
2. Run `npm run build`
3. Run `npm run export:release`
4. Run `npm run build:docs-satellite` if you want the public component-detail bundle used by `octo-docs`

That produces the exported bundle under `out/export/`.

`npm run build:docs-satellite` writes `out/docs-satellite/`, which is the public component-detail bundle consumed by `octo-docs` when a live runtime plugin, service, or shared library is sourced from `openclaw-hub`.
