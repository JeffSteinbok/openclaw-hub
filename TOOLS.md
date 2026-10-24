# Tools

Quick reference of available tools for the OpenClaw agent.

## Plugins

Registered plugin tools are listed in each plugin's `openclaw.plugin.json` manifest (auto-generated at build time). The gateway loads these automatically.

## CLIs

Binaries in `~/safebin/` available via the `exec` tool (safebin):

| CLI | Description | Usage |
|-----|-------------|-------|
| `waitlistme` | Join a Waitlist.me queue | `waitlistme add --name "Jeff" --party 2 --location sammamishcafe` |
| `applemaps` | Apple Maps via MapKit: drive times (`--arriveAt`/`--departAt`), directions, place lookup, map images with pins. Allowlisted per agent, not a safe bin. Source: [mcp/mapkit](mcp/mapkit/) | `applemaps estimateTravelTime --originLatitude 47.6 --originLongitude -122.0 --destinationLatitude 47.44 --destinationLongitude -122.3 --arriveAt 2026-10-25T08:00:00-07:00` |
