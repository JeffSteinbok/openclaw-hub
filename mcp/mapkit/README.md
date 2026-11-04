# MapKit (`applemaps`)

Apple Maps for the agent through the Mac's own MapKit: place lookup, drive times, directions and map images. It needs no API key or Apple Developer account. It runs on macOS only, in a logged-in user session (the gateway's LaunchAgent is fine).

One binary, two ways in: `applemaps <tool> --option value` on the command line, or `applemaps mcp` as an MCP server on stdio. Both run the same tools.

Based on [jsflax/MapKitMCP](https://github.com/jsflax/MapKitMCP) (MIT, see [LICENSE](LICENSE)), with these changes:

- `departAt` / `arriveAt` on `estimateTravelTime`, `getDirections` and `getDirectionsByAddress` for traffic-aware estimates. With `arriveAt`, `departureTime` in the result is when to leave.
- `mapSnapshot` draws labeled `pins`, fits the map to the pins when no center is given, and with `saveToFile` writes a PNG and returns its path, for attaching to a message.
- `geocode` and `getDirectionsByAddress` look places up with MapKit's place search first, so landmarks and business names resolve correctly; CLGeocoder is the fallback.
- MapKit failures come back as tool errors instead of protocol errors.
- Whole-number JSON arguments work (`"radiusMeters": 2000` used to be ignored because it decodes as an integer).
- A command-line mode, and tool safety annotations (all read-only except `mapSnapshot`, which can write a PNG).
- MCP Swift SDK 0.12 (0.10 doesn't build with Swift 6.4).

## Tools

| Tool | Description |
|------|-------------|
| `geocode` | Address or place name to coordinates |
| `reverseGeocode` | Coordinates to an address |
| `searchPlaces` | Search for places near a location |
| `searchByCategory` | Points of interest by category (cafe, hospital, park, ...) near a location |
| `estimateTravelTime` | Travel time between two coordinates, optionally leaving or arriving at a set time |
| `getDirections` | Step-by-step directions between two coordinates |
| `getDirectionsByAddress` | Step-by-step directions between two addresses or place names |
| `calculateDistance` | Straight-line distance between two coordinates |
| `mapSnapshot` | Static map image, optionally with labeled pins |

Times are ISO 8601 with an offset, e.g. `2026-10-25T08:00:00-07:00`.

## Build and test

```bash
cd mcp/mapkit
swift test
swift build -c release
```

The binary is `.build/release/applemaps`.

With Swift 6.4, `swift test` sometimes fails with "plugin for module 'TestingMacros' not found". That's the toolchain, not the code: delete `.build` and run it again.

## Use from OpenClaw

### Command line (agents on the Claude CLI backend)

Claude CLI agents get outside MCP servers as native tools, and an agent whose exec policy is `allowlist` denies those. Give such an agent the command line instead:

```bash
install -m 755 .build/release/applemaps ~/safebin/applemaps
openclaw approvals allowlist add --agent main ~/safebin/applemaps
```

The agent runs it with `exec`, e.g. `applemaps estimateTravelTime --originLatitude 47.6 --originLongitude -122.0 --destinationLatitude 47.44 --destinationLongitude -122.3 --arriveAt 2026-10-25T08:00:00-07:00`. `applemaps help` and `applemaps help <tool>` list the options. Run it on its own: every segment of a pipeline has to pass the allowlist. On the command line, `mapSnapshot` always writes a file and prints its path.

### MCP server

For runtimes that call MCP tools directly:

```bash
openclaw mcp add mapkit --command ~/safebin/applemaps --arg mcp
openclaw mcp probe mapkit
```

### Map image location

`mapSnapshot` files go to `MAPKIT_OUTPUT_DIR` if set, otherwise `~/.openclaw/media/outbound/maps` (when `~/.openclaw/media` exists, so the agent can attach them), otherwise a `mapkit-mcp` folder in the temp directory.
