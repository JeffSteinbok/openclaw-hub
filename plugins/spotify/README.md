# Spotify

Control playback, search the catalog, and manage playlists from OpenClaw. The plugin is geared toward quick everyday listening tasks like starting music on a device, finding something to play, or dropping a track into a playlist.

## Tools

| Tool | Description |
|------|-------------|
| `spotify_now_playing` | Get the currently playing track or episode |
| `spotify_play` | Start or resume playback; optionally play a specific URI |
| `spotify_pause` | Pause playback |
| `spotify_next` | Skip to the next track |
| `spotify_previous` | Go back to the previous track |
| `spotify_search` | Search for tracks, albums, artists, or playlists |
| `spotify_add_to_playlist` | Add a track to a playlist |
| `spotify_get_playlists` | List the user's playlists |
| `spotify_get_devices` | List available Spotify Connect devices |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SPOTIFY_CLIENT_ID` | Spotify app client ID |
| `SPOTIFY_CLIENT_SECRET` | Spotify app client secret |
| `SPOTIFY_REDIRECT_URI` | OAuth redirect URI (default: `http://127.0.0.1:8888/callback`) |

These should be set in `~/.openclaw/.env` alongside other secrets.

## Setup

1. Create a Spotify app at https://developer.spotify.com/dashboard
2. Set the redirect URI to `http://127.0.0.1:8888/callback`
3. Add `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` to `~/.openclaw/.env`
4. On first use, spotipy will prompt for a one-time browser authorization. After that, refresh tokens are cached at `~/.openclaw/.spotify_token_cache`.

**Requires Spotify Premium** for playback control endpoints.

## Python Dependencies

The `spotipy` package must be installed in the Python environment:

```
pip install spotipy
```

## Plugin Structure

```
openclaw.plugin.json
src/index.ts
src/tools.py
src/spotify_client.py
```

## Notes

- Playback control (play, pause, next, previous) requires an active Spotify device
- Use `spotify_get_devices` to find available devices and pass `device_id` to target a specific one
- Search results include Spotify URIs that can be passed directly to `spotify_play`
- Token cache is stored at `~/.openclaw/.spotify_token_cache` (auto-refreshed)
