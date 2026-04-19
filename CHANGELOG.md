# Changelog

## 2026.4.19

- turned `openclaw-hub` into a source-and-release repo instead of a GitHub Pages site
- added root build/export scripts and copied the Python plugin framework needed to build mirrored plugins in place
- added `release-manifest.json` plus a GitHub Actions workflow that creates a single downloadable bundle release
- normalized mirrored plugin metadata and patch-bumped the initial public artifact versions
- removed the `config-backup` and `github` plugins from the public hub surface
- rewrote the root README around the shared mail runtime and switched releases away from per-plugin downloads
