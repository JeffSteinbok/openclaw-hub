# OpenTable

Look up OpenTable restaurant IDs, check booking availability, and monitor integration health. The plugin works best as a two-step flow: resolve the restaurant slug first, then request openings for the restaurant ID you found.

## Tools

| Tool | Description |
|------|-------------|
| `opentable_lookup` | Look up a restaurant by URL slug (e.g. `carbone-new-york`) to get its numeric ID |
| `opentable_availability` | Check real-time availability; returns time slots with booking URLs |
| `opentable_heartbeat_check` | Verify the OpenTable integration is healthy (lookup + availability) |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENTABLE_AVAILABILITY_HASH` | API hash required for availability requests |
| `NOTIFY_CHANNEL` | Notification channel for heartbeat alerts (default: `discord`) |
| `NOTIFY_TARGET` | Notification target (e.g. webhook URL) |

## Notes

- Two-step workflow: first `opentable_lookup` to get the restaurant ID from a URL slug, then `opentable_availability` with date/time/party size.
- Python dependencies: `requests>=2.28.0`, `curl_cffi>=0.7.0`.
- `opentable_availability` and the preferred `opentable_lookup` path both use a browser-impersonated session via `curl_cffi` because OpenTable may block plain scripted page fetches.
- `OPENTABLE_AVAILABILITY_HASH` only affects the availability GraphQL call. If slug lookup fails with `403`, that is a separate restaurant-page access issue, not necessarily a bad hash.
- `opentable_heartbeat_check` verifies both lookup and availability paths, so a stale hash will be caught.

## Plugin Structure

```
openclaw.plugin.json
src/tools.py
src/opentable_client.py
requirements.txt
tests/
```
