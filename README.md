# OpenClaw Hub

Public source and release repo for the OpenClaw surfaces that can live outside the private [`octo`](https://github.com/JeffSteinbok/octo) monorepo.

`openclaw-hub` is **not** a GitHub Pages site. Public documentation lives in [`octo-docs`](https://github.com/JeffSteinbok/octo-docs). This repo is for source browsing and release artifacts.

## Canonical source

- The private canonical repo is still [`octo`](https://github.com/JeffSteinbok/octo) until cutover.
- Mirrored plugin manifests keep `source.canonicalRepo` pointed at `JeffSteinbok/octo` while this repo is still a mirror.
- `release-manifest.json` defines the current multi-asset release set for this repo.

## Relationship to octo-docs

[`octo-docs`](https://github.com/JeffSteinbok/octo-docs) publishes public-facing docs from sanitized bundle data produced in `octo`.

For selected public surfaces, the docs point readers here for browseable source:

- `plugins/*`
- `services/*`
- `libs/python/*`

## Building and releasing

1. Run `npm install`
2. Run `npm run build`
3. Run `npm run export:release`

That produces self-contained artifacts in `out/export/`, with vendored shared Python libs. The GitHub Actions workflow `.github/workflows/release-artifacts.yml` packages those exports into **one release with many downloadable assets**.

## Source index

### Plugins

| Plugin | Version | README |
| --- | --- | --- |
| config-backup | 1.0.1 | [`plugins/config-backup/README.md`](plugins/config-backup/README.md) |
| fastmail | 1.0.1 | [`plugins/fastmail/README.md`](plugins/fastmail/README.md) |
| github | 1.5.1 | [`plugins/github/README.md`](plugins/github/README.md) |
| homeassistant | 1.0.1 | [`plugins/homeassistant/README.md`](plugins/homeassistant/README.md) |
| ics-calendar | 1.0.1 | [`plugins/ics-calendar/README.md`](plugins/ics-calendar/README.md) |
| llmvision | 1.0.1 | [`plugins/llmvision/README.md`](plugins/llmvision/README.md) |
| outlook-calendar | 1.0.1 | [`plugins/outlook-calendar/README.md`](plugins/outlook-calendar/README.md) |
| outlook-mail | 1.0.1 | [`plugins/outlook-mail/README.md`](plugins/outlook-mail/README.md) |
| outlook-work-calendar | 1.0.1 | [`plugins/outlook-work-calendar/README.md`](plugins/outlook-work-calendar/README.md) |
| package-tracking | 1.0.1 | [`plugins/package-tracking/README.md`](plugins/package-tracking/README.md) |
| spotify | 1.0.1 | [`plugins/spotify/README.md`](plugins/spotify/README.md) |
| stock-quotes | 1.0.1 | [`plugins/stock-quotes/README.md`](plugins/stock-quotes/README.md) |
| usps-mail | 1.0.1 | [`plugins/usps-mail/README.md`](plugins/usps-mail/README.md) |

### Services

| Service | Version | README |
| --- | --- | --- |
| fastmail-sse | 1.0.1 | [`services/fastmail-sse/README.md`](services/fastmail-sse/README.md) |

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
