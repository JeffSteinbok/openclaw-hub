# Changelog

## 2026-05-09

### Added
- **Built-in carrier status providers** — USPS, FedEx, and UPS status lookups now ship with `package_tracking_core` and auto-register when the plugin loads. No configuration needed.
- **Camoufox web scraper** — Python-based scraper using a stealth Firefox fork to extract tracking data from carrier websites. Handles bot detection, SPA hydration timing, and carrier-specific DOM/regex extraction.
- **Provider registry with fallback chain** — providers are tried in reverse registration order; external/API providers override built-ins. If a provider returns `null`, the next one is tried.
- **`addPackage()` extra param** — core `addPackage()` now accepts an optional `extra` record for carrier-specific metadata (e.g., `order_id` for Amazon).
- **`order_id` on `package_add` tool** — the plugin tool now accepts an `order_id` parameter for Amazon package tracking.
- **Satellite tracking endpoints** — FedEx and Amazon tracking endpoints added to octo-satellite plugin.

### Changed
- Providers moved from standalone `camoufox_status_provider` package into `package_tracking_core/src/providers/`.
- Plugin auto-registers built-in providers on startup (previously required manual `status_providers` config).
- README updated with Mermaid architecture diagram, provider extension guide, and prerequisites.

## 2026-05-07

### Added
- **CLI generation system** — all plugins can now run as standalone CLIs via `@openclaw/cli-shared`. The library introspects `createEntry()` metadata and generates CLI entry points at build time.
- Added `libs/ts/cli_shared` with runtime + build-time generator.
- Extracted `handlers.ts` (pure business logic) from all plugins.
- Added CLI Usage sections to all plugin READMEs and `PLUGIN_README_SHAPE.md`.
- Created READMEs for fastmail and usps-mail plugins.
- Comprehensive documentation overhaul: plugins/README.md, cli-shared README, main README update.

### Migrated
- Moved `octo-satellite` and `weightwatchers` plugins from [octo](https://github.com/JeffSteinbok/octo) (open-sourced).
- Renamed satellite directory to `octo-satellite`.

### Changed
- All plugin `package.json` files now include `bin` field and `generate-cli` build step.
- All plugin `tsup.config.ts` entries include `src/handlers.ts` and `src/adapter.ts`.
- Root `package.json` workspaces and build ordering fixed for CI.

## 2026-05-06

### Added
- **md-to-html** plugin — styled Markdown-to-HTML renderer with callouts, phase headers, total rows, and syntax highlighting tool.
- **html-to-pdf** plugin added to release manifest with CI support.
- **package-tracking** README with pluggable carrier status provider docs.
- DKIM/SPF/DMARC authentication checks on incoming mail in mail runtime.
- USPS custom rules guide with patterns, ordering, and testing tips.
- Dynamic action plugin loading and pluggable carrier status providers in mail pipeline.
- Node mock API for extracting tool metadata from TypeScript plugins in the docs bundle pipeline.

### Fixed
- `createEntry` pattern and fallback entry points in tool extraction for docs.

## 2026-05-05

### Added
- Dynamic action plugins and pluggable carrier status providers for the mail pipeline.

### Fixed
- **llmvision**: use binary-safe buffer collection for image fetch.

## 2026-05-04

### Fixed
- **withings**: use `action=requesttoken` for token refresh.

## 2026-05-03

### Added
- Extracted shared `@openclaw/plugin-utils` library from duplicated plugin boilerplate.

### Fixed
- **fastmail-sse**: deduplicate emails on JMAP state regression.

### Changed
- Plugin tests refactored to mock `@openclaw/plugin-utils` instead of `node:http/https`.

## 2026-05-02

### Added
- Complete Python-to-TypeScript migration: all libs, plugins, and fastmail-sse service ported to TypeScript.
- TypeScript-native versions of all remaining bridge plugins.

### Fixed
- Workspace lib exports pointed to source for resolution.
- Test spy registration for vitest v4 compatibility.

## 2026-04-19

### Added
- Turned `openclaw-hub` into a source-and-release repo instead of a GitHub Pages site.
- Root build/export scripts and Python plugin framework for mirrored plugins.
- `release-manifest.json` and GitHub Actions workflow for single downloadable bundle releases.
- MIT license.

### Changed
- Normalized mirrored plugin metadata and patch-bumped initial public artifact versions.
- Removed `config-backup` and `github` plugins from the public hub surface.
- Rewrote root README around shared mail runtime; switched releases away from per-plugin downloads.

## 2026-04-12

### Added
- Mirror public source from openclaw.

## 2026-03-04 – 2026-03-07

### Added
- Initial repository with skills/ and services/ structure.
- **fastmail-sse** service with JMAP push, mail triage, and notification pipeline.
- **fastmail** skill with JMAP Calendar integration, CalDAV scheduling, inbox search, RSVP tracking.
- **hass-camera-snapshot** skill.
- **opentable** availability skill.
- Jekyll docs site and GitHub Pages workflow.
- Secret scanning workflow with issue alerting.

### Changed
- Reorganized from flat to skills/ and services/ subdirectories.
- Removed migrated skills and services (moved to octo).
