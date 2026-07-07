# Goodreads Plugin

Headless Playwright-based Goodreads integration for OpenClaw.

## Why this exists

The generic OpenClaw browser tool gets HTTP 403 from Goodreads because the default Playwright automation fingerprint is too bot-like. This plugin uses a realistic browser context (Chrome UA, 1280×900 viewport, en-US locale) that bypasses Goodreads bot detection, as validated in [octo issue #193](https://github.com/JeffSteinbok/octo/issues/193).

## Configuration

Set via plugin config or environment variables:

| Env var | Description |
|---|---|
| `GOODREADS_USERNAME` | Goodreads email address |
| `GOODREADS_PASSWORD` | Goodreads password |
| `GOODREADS_STATE_FILE` | Session state path (default: `~/.openclaw/state/goodreads.json`) |

## Tools

### `goodreads_auth_status`
Check if the current session is valid. Returns `{ authenticated, username?, error? }`.

### `goodreads_login`
Log in to Goodreads and persist session state. Call this once (or when session expires).

### `goodreads_list_shelf`
List books from a shelf. Parameters:
- `shelf`: `"read"` | `"currently-reading"` | `"to-read"`
- `page`: page number (default 1)
- `limit`: books per page (default 20, max 200)

Returns structured `BookRecord[]` with title, author, URL, ratings, and dates.

### `goodreads_search`
Search for books by title, author, or ISBN. Parameters:
- `query`: search string
- `limit`: max results (default 10)

## Session management

Sessions are persisted to `~/.openclaw/state/goodreads.json`. If a shelf request detects an expired session, it will automatically attempt re-login before retrying.

## Anti-403 browser context

All Playwright operations use:
```
User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36
Viewport:   1280×900
Locale:     en-US
```
