# repo_paths

Shared bootstrap helpers for Python entrypoints that need to run from either:

- the in-repo development layout (`libs/python/*`), or
- an exported artifact layout with a sibling vendored `python/` directory.

## Why it exists

Plugins and services in this repo often need shared Python code, but they may run from two different layouts:

1. **Repo checkout** — shared code lives in `libs/python/*`
2. **Exported artifact** — shared code is vendored into a sibling `python/` directory

`repo_paths` centralizes the logic for preferring vendored artifact libs first while still supporting direct in-repo execution.

## Main entrypoint

Use `bootstrap_repo_paths(__file__, legacy_subdirs=(...))` from Python entrypoints that need shared imports.

It:

- looks for a sibling `python/` directory first
- falls back to repo-local `libs/python/`
- optionally appends legacy compatibility paths while migrations are still in progress

## Typical usage

```python
from repo_paths.bootstrap import bootstrap_repo_paths

BOOTSTRAP_PATHS = bootstrap_repo_paths(__file__)
```

That makes shared packages such as `mail_runtime_core`, `mail_action_usps`, and `package_tracking_core` importable in both dev and exported-artifact layouts.
