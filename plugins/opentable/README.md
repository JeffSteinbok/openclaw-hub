# OpenTable

Look up OpenTable restaurant IDs, check booking availability, and monitor integration health. The plugin works best as a two-step flow: resolve the restaurant slug first, then request openings for the restaurant ID you found.

## Tools

| Tool | Description |
|------|-------------|
| `opentable_lookup` | Look up a restaurant by URL slug (e.g. `carbone-new-york`) to get its numeric ID |
| `opentable_availability` | Check real-time availability; returns time slots with booking URLs |
| `opentable_heartbeat_check` | Verify the OpenTable integration is healthy (lookup + availability) |

## Configuration Schema

```json
{
  "availabilityHash": "b2d05a06...",
  "notifyChannel": "discord",
  "notifyTarget": "jeff-dm"
}
```

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `availabilityHash` | string | No | Persisted-query hash for OpenTable availability GraphQL (has built-in default) |
| `notifyChannel` | string | No | Notification channel for heartbeat alerts (default: `discord`) |
| `notifyTarget` | string | No | Notification target for heartbeat alerts |

## Notes

- Two-step workflow: first `opentable_lookup` to get the restaurant ID from a URL slug, then `opentable_availability` with date/time/party size.
- Python dependencies: `requests>=2.28.0`, `curl_cffi>=0.7.0`.
- Uses a browser-impersonated session via `curl_cffi` to bypass OpenTable's bot protection.
- `availabilityHash` only affects the availability GraphQL call. If slug lookup fails with `403`, that is a separate restaurant-page access issue.
- `opentable_heartbeat_check` verifies both lookup and availability paths, so a stale hash will be caught.

## Development

### Build

```bash
npm run build --workspace=plugins/opentable
```
