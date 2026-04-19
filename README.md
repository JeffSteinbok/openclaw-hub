# OpenClaw Hub

Public plugins, services, and shared libraries for use in OpenClaw.

These are the public OpenClaw components I use in my own assistant. For the higher-level docs and examples around that assistant, see [`octo-docs`](https://jeffsteinbok.github.io/octo-docs/).

## Mail Runtime

The core of this repo is the shared **Mail Runtime**:

- [`libs/python/mail_runtime_core/`](libs/python/mail_runtime_core/README.md) provides the provider-agnostic mail pipeline
- [`libs/python/mail_action_usps/`](libs/python/mail_action_usps/README.md) provides the USPS action module used by that pipeline
- [`services/fastmail-sse/`](services/fastmail-sse/README.md) is a FastMail adapter that feeds real-time mail into the shared runtime

The point of the runtime is to separate **where mail comes from** from **what OpenClaw does with it**. A mail source turns provider events into a normalized `MailEnvelope`, the runtime evaluates ordered `mail_rules`, and named actions handle the actual work.

At a high level, the flow is:

1. a source adapter notices new mail
2. it normalizes that message into a `MailEnvelope`
3. `mail_runtime_core` evaluates `mail_rules`
4. matching actions run against the normalized envelope
5. the adapter dispatches the structured results into notifications, memory updates, or follow-up work

### Mail actions

The shared runtime currently revolves around three important mail actions:

| Action | Where it lives | What it does |
| --- | --- | --- |
| `notify_email` | `mail_runtime_core` | Formats and routes a notification for a matching message |
| `detect_tracking` | `mail_runtime_core` + `package_tracking_core` | Extracts tracking numbers and URLs from mail and routes package-tracking work |
| `process_usps_digest` | `mail_action_usps` | Downloads and analyzes USPS Informed Delivery digests, applies USPS rules, sends notifications, and writes longer-term memory |

### FastMail SSE

[`services/fastmail-sse`](services/fastmail-sse/README.md) is one of the ways to call into the mail runtime. It connects to FastMail's JMAP EventSource stream, turns incoming mail into `MailEnvelope` objects, registers shared and domain mail actions, and then lets the runtime do the rest.

That makes FastMail SSE the current **live ingestion path** for automated mail handling in this repo, while the runtime stays reusable for future sources such as polling or webhook adapters.

### Runtime companions

Some other pieces in this repo are closely tied to the mail runtime:

- [`libs/python/package_tracking_core/`](libs/python/package_tracking_core/README.md) is the shared tracking engine behind `detect_tracking`
- [`plugins/package-tracking/`](plugins/package-tracking/README.md) is the interactive OpenClaw tool surface for package tracking
- [`plugins/usps-mail/`](plugins/usps-mail/README.md) is the manual/operator-facing tool surface over the shared USPS workflow

## What this repo contains

### Mail runtime pieces

| Component | README |
| --- | --- |
| fastmail-sse service | [`services/fastmail-sse/README.md`](services/fastmail-sse/README.md) |
| mail_action_usps | [`libs/python/mail_action_usps/README.md`](libs/python/mail_action_usps/README.md) |
| mail_runtime_core | [`libs/python/mail_runtime_core/README.md`](libs/python/mail_runtime_core/README.md) |
| package_tracking_core | [`libs/python/package_tracking_core/README.md`](libs/python/package_tracking_core/README.md) |
| package-tracking plugin | [`plugins/package-tracking/README.md`](plugins/package-tracking/README.md) |
| usps-mail plugin | [`plugins/usps-mail/README.md`](plugins/usps-mail/README.md) |

### Independent plugins

These plugins are more stand-alone. They do not form part of the shared mail runtime stack above.

| Plugin | README |
| --- | --- |
| fastmail | [`plugins/fastmail/README.md`](plugins/fastmail/README.md) |
| homeassistant | [`plugins/homeassistant/README.md`](plugins/homeassistant/README.md) |
| ics-calendar | [`plugins/ics-calendar/README.md`](plugins/ics-calendar/README.md) |
| llmvision | [`plugins/llmvision/README.md`](plugins/llmvision/README.md) |
| outlook-calendar | [`plugins/outlook-calendar/README.md`](plugins/outlook-calendar/README.md) |
| outlook-mail | [`plugins/outlook-mail/README.md`](plugins/outlook-mail/README.md) |
| outlook-work-calendar | [`plugins/outlook-work-calendar/README.md`](plugins/outlook-work-calendar/README.md) |
| spotify | [`plugins/spotify/README.md`](plugins/spotify/README.md) |
| stock-quotes | [`plugins/stock-quotes/README.md`](plugins/stock-quotes/README.md) |

### Shared support libraries

| Library | README |
| --- | --- |
| repo_paths | [`libs/python/repo_paths/README.md`](libs/python/repo_paths/README.md) |

### Build support

| Package | README |
| --- | --- |
| framework | [`plugins/framework/README.md`](plugins/framework/README.md) |

## Downloading

Download the **whole release bundle** from the latest GitHub release. The bundle contains the exported plugin and service artifacts together, plus the vendored shared Python libraries they need.

This repo is small enough that shipping one bundle is simpler than publishing and tracking separate per-plugin downloads.

## Building locally

1. Run `npm install`
2. Run `npm run build`
3. Run `npm run export:release`

That produces the exported runtime bundle under `out/export/`.
