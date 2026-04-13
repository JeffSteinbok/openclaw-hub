"""
Spotify client — authenticated spotipy wrapper.

Reads credentials from environment variables and provides a configured
Spotify client with automatic token refresh.
"""

import os
import spotipy
from spotipy.oauth2 import SpotifyOAuth

SCOPES = " ".join([
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
    "playlist-read-private",
    "playlist-modify-public",
    "playlist-modify-private",
])


def get_client() -> spotipy.Spotify:
    """Return an authenticated Spotify client.

    Expects these environment variables:
        SPOTIFY_CLIENT_ID
        SPOTIFY_CLIENT_SECRET
        SPOTIFY_REDIRECT_URI  (default: http://127.0.0.1:8888/callback)

    Token cache is stored at ~/.openclaw/.spotify_token_cache
    """
    cache_dir = os.path.expanduser("~/.openclaw")
    os.makedirs(cache_dir, exist_ok=True)
    cache_path = os.path.join(cache_dir, ".spotify_token_cache")

    client_id = os.environ.get("SPOTIFY_CLIENT_ID")
    client_secret = os.environ.get("SPOTIFY_CLIENT_SECRET")
    redirect_uri = os.environ.get("SPOTIFY_REDIRECT_URI", "http://127.0.0.1:8888/callback")

    if not client_id or not client_secret:
        raise RuntimeError(
            "SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set"
        )

    auth_manager = SpotifyOAuth(
        client_id=client_id,
        client_secret=client_secret,
        redirect_uri=redirect_uri,
        scope=SCOPES,
        cache_path=cache_path,
        open_browser=False,
    )

    return spotipy.Spotify(auth_manager=auth_manager)
