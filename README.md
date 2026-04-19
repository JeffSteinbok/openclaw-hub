# OpenClaw Hub

Public plugins, services, and shared libraries for use in OpenClaw.

These are the public OpenClaw components I use in my own assistant. You can learn more about my personal assistant, Octo, here [`octo-docs`](https://jeffsteinbok.github.io/octo-docs/).

## Building and releasing

1. Run `npm install`
2. Run `npm run build`
3. Run `npm run export:release`

That produces self-contained artifacts in `out/export/`, with vendored shared Python libs. The GitHub Actions workflow `.github/workflows/release-artifacts.yml` packages those exports into **one release with many downloadable assets**.

## Source index

### Plugins

| Plugin | README |
| --- | --- |
| config-backup | [`plugins/config-backup/README.md`](plugins/config-backup/README.md) |
| fastmail | [`plugins/fastmail/README.md`](plugins/fastmail/README.md) |
| github | [`plugins/github/README.md`](plugins/github/README.md) |
| homeassistant | [`plugins/homeassistant/README.md`](plugins/homeassistant/README.md) |
| ics-calendar | [`plugins/ics-calendar/README.md`](plugins/ics-calendar/README.md) |
| llmvision | [`plugins/llmvision/README.md`](plugins/llmvision/README.md) |
| outlook-calendar | [`plugins/outlook-calendar/README.md`](plugins/outlook-calendar/README.md) |
| outlook-mail | [`plugins/outlook-mail/README.md`](plugins/outlook-mail/README.md) |
| outlook-work-calendar | [`plugins/outlook-work-calendar/README.md`](plugins/outlook-work-calendar/README.md) |
| package-tracking | [`plugins/package-tracking/README.md`](plugins/package-tracking/README.md) |
| spotify | [`plugins/spotify/README.md`](plugins/spotify/README.md) |
| stock-quotes | [`plugins/stock-quotes/README.md`](plugins/stock-quotes/README.md) |
| usps-mail | [`plugins/usps-mail/README.md`](plugins/usps-mail/README.md) |

### Services

| Service | README |
| --- | --- |
| fastmail-sse | [`services/fastmail-sse/README.md`](services/fastmail-sse/README.md) |

### Shared Python libs

| Library | README |
| --- | --- |
| mail_action_usps | [`libs/python/mail_action_usps/README.md`](libs/python/mail_action_usps/README.md) |
| mail_runtime_core | [`libs/python/mail_runtime_core/README.md`](libs/python/mail_runtime_core/README.md) |
| package_tracking_core | [`libs/python/package_tracking_core/README.md`](libs/python/package_tracking_core/README.md) |
| repo_paths | [`libs/python/repo_paths/README.md`](libs/python/repo_paths/README.md) |

### Build support

| Package | README |
| --- | --- |
| framework | [`plugins/framework/README.md`](plugins/framework/README.md) |
