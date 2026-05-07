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

## Configuration Schema

```json
{
  "clientId": "your_spotify_client_id",
  "clientSecret": "your_spotify_client_secret",
  "redirectUri": "http://127.0.0.1:8888/callback"
}
```

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `clientId` | string | Yes | Spotify app client ID |
| `clientSecret` | string | Yes | Spotify app client secret |
| `redirectUri` | string | No | OAuth redirect URI (default: `http://127.0.0.1:8888/callback`) |

## Example config

Set credentials in `plugins.entries["spotify"].config`:

```json
{
  "plugins": {
    "entries": {
      "spotify": {
        "enabled": true,
        "config": {
          "clientId": "your_spotify_client_id",
          "clientSecret": "your_spotify_client_secret",
          "redirectUri": "http://127.0.0.1:8888/callback"
        }
      }
    }
  }
}
```

## Setup

1. Create a Spotify app at https://developer.spotify.com/dashboard
2. Set the redirect URI to `http://127.0.0.1:8888/callback`
3. Add `clientId` and `clientSecret` to the plugin config
4. On first use, spotipy will prompt for a one-time browser authorization. After that, refresh tokens are cached at `~/.openclaw/.spotify_token_cache`.

**Requires Spotify Premium** for playback control endpoints.

## Python Dependencies

```
pip install spotipy
```

## Notes

- Playback control (play, pause, next, previous) requires an active Spotify device
- Use `spotify_get_devices` to find available devices and pass `device_id` to target a specific one
- Search results include Spotify URIs that can be passed directly to `spotify_play`
- Token cache is stored at `~/.openclaw/.spotify_token_cache` (auto-refreshed)
