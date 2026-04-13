# Shared Python libs

This directory is the canonical home for reusable Python code that may be imported by both `plugins/` and `services/`.

## Dependency direction

- `plugins/*` may import from `libs/python/*`
- `services/*` may import from `libs/python/*`
- `plugins/*` should not import from `services/*` for shared business logic
- `services/*` should not import from `plugins/*` for shared business logic

## Current transition state

Some reusable subsystems still live under `services/` or plugin source trees while follow-up migrations land. During that transition, entrypoints should:

1. bootstrap `libs/python` first
2. import shared helpers from `libs/python/*`
3. only add legacy repo paths when needed for compatibility with not-yet-migrated modules

## Bootstrap helper

Use `repo_paths.bootstrap.bootstrap_repo_paths(__file__, legacy_subdirs=(...))` from scripts that need shared imports.

- In-repo execution prefers `libs/python/`
- Published artifacts can vendor a sibling `python/` directory, which is preferred over the repo path
- Legacy subdirs can be added temporarily while migrations are still in progress

## Current libraries

- `repo_paths/` — shared import/bootstrap helpers for plugin and service Python entrypoints
- `mail_runtime_core/` — provider-agnostic mail runtime core (envelopes, rules, registry, results)
- `mail_action_usps/` — USPS Informed Delivery action module shared by Fastmail SSE and the USPS plugin
- `package_tracking_core/` — shared carrier detection, tracking storage, sender heuristics, and URL extraction
