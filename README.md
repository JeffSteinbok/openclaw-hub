# OpenClaw Hub

Mirror repo for selected public OpenClaw source.

This repo now carries copied public plugins, services, and shared libs from the main [`octo`](https://github.com/JeffSteinbok/octo) repo so content can be edited and synced across repos by simple copy operations.

## Canonical source

- Unless a copied manifest says otherwise, the canonical source still lives in `octo`
- Public plugin manifests include source metadata pointing at the canonical repo/path
- Mirrored copies here are intended to be kept in sync manually by copying edits in either direction

## Relationship to octo-docs

[`octo-docs`](https://github.com/JeffSteinbok/octo-docs) publishes public-facing documentation generated from sanitized bundle data produced by the private `octo` repo.

For selected public surfaces, this repo is the **public source mirror** that readers can browse directly:

- plugins under `plugins/*`
- services under `services/*`
- shared Python libs under `libs/python/*`

That means the docs can describe Octo from bundle data while the corresponding public source lives here in `openclaw-hub`.

## Mirrored content

### Plugins

- `config-backup`
- `fastmail`
- `github`
- `homeassistant`
- `ics-calendar`
- `llmvision`
- `outlook-calendar`
- `outlook-mail`
- `outlook-work-calendar`
- `package-tracking`
- `spotify`
- `stock-quotes`
- `usps-mail`

### Services

- `fastmail-sse`

### Shared libs

- `libs/python/mail_runtime_core`
- `libs/python/mail_action_usps`
- `libs/python/package_tracking_core`
- `libs/python/repo_paths`
