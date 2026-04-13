"""Unit tests for the Spotify plugin (no network access required).

Covers:
  - handle_search: query validation, type key derivation, result shaping
  - handle_add_to_playlist: validation for missing playlist_id / track_uri
  - handle_now_playing: mocked client, playing/not-playing states
  - handle_play: mocked client, track/album/playlist URI routing
  - handle_pause/next/previous: mocked client calls
  - handle_get_playlists: mocked client, result shaping
  - handle_get_devices: mocked client, result shaping
  - manifest: structure validation and tool enumeration
"""

import os
import sys
import unittest
from unittest.mock import MagicMock, patch

_SRC_DIR = os.path.join(os.path.dirname(__file__), "..", "src")
sys.path.insert(0, _SRC_DIR)

# Provide dummy env vars so spotify_client.py can be imported
os.environ.setdefault("SPOTIFY_CLIENT_ID", "test-client-id")
os.environ.setdefault("SPOTIFY_CLIENT_SECRET", "test-client-secret")

import tools


def _mock_client():
    """Return a MagicMock that quacks like a spotipy.Spotify instance."""
    return MagicMock()


# ---------------------------------------------------------------------------
# handle_search
# ---------------------------------------------------------------------------

class TestHandleSearch(unittest.TestCase):
    """handle_search: validation and result shaping."""

    def test_missing_query_returns_error(self):
        result = tools.handle_search({})
        self.assertIn("error", result)

    def test_empty_query_returns_error(self):
        result = tools.handle_search({"query": "  "})
        self.assertIn("error", result)

    def test_search_track_result_has_expected_fields(self):
        sp = _mock_client()
        sp.search.return_value = {
            "tracks": {
                "total": 1,
                "items": [{
                    "name": "Digital Love",
                    "uri": "spotify:track:abc123",
                    "artists": [{"name": "Daft Punk"}],
                    "album": {"name": "Discovery"},
                    "duration_ms": 300000,
                }],
            }
        }
        with patch("tools.get_client", return_value=sp):
            result = tools.handle_search({"query": "Digital Love"})
        self.assertNotIn("error", result)
        self.assertEqual(result["total"], 1)
        item = result["results"][0]
        self.assertEqual(item["name"], "Digital Love")
        self.assertIn("artist", item)
        self.assertIn("album", item)
        self.assertIn("uri", item)

    def test_search_album_result_shape(self):
        sp = _mock_client()
        sp.search.return_value = {
            "albums": {
                "total": 1,
                "items": [{
                    "name": "Discovery",
                    "uri": "spotify:album:xyz",
                    "artists": [{"name": "Daft Punk"}],
                    "total_tracks": 14,
                    "release_date": "2001-03-13",
                }],
            }
        }
        with patch("tools.get_client", return_value=sp):
            result = tools.handle_search({"query": "Discovery", "type": "album"})
        item = result["results"][0]
        self.assertIn("total_tracks", item)
        self.assertIn("release_date", item)

    def test_limit_capped_at_50(self):
        sp = _mock_client()
        sp.search.return_value = {"tracks": {"total": 0, "items": []}}
        with patch("tools.get_client", return_value=sp):
            tools.handle_search({"query": "test", "limit": 999})
        _, kwargs = sp.search.call_args
        self.assertLessEqual(kwargs.get("limit", sp.search.call_args[1].get("limit")), 50)

    def test_client_exception_returns_error(self):
        with patch("tools.get_client", side_effect=RuntimeError("No credentials")):
            result = tools.handle_search({"query": "test"})
        self.assertIn("error", result)


# ---------------------------------------------------------------------------
# handle_add_to_playlist
# ---------------------------------------------------------------------------

class TestHandleAddToPlaylist(unittest.TestCase):
    """handle_add_to_playlist: validation and mocked API call."""

    def test_missing_playlist_id_returns_error(self):
        result = tools.handle_add_to_playlist({"track_uri": "spotify:track:abc"})
        self.assertIn("error", result)

    def test_missing_track_uri_returns_error(self):
        result = tools.handle_add_to_playlist({"playlist_id": "pl123"})
        self.assertIn("error", result)

    def test_both_missing_returns_error(self):
        result = tools.handle_add_to_playlist({})
        self.assertIn("error", result)

    def test_successful_add(self):
        sp = _mock_client()
        sp.playlist_add_items.return_value = {}
        with patch("tools.get_client", return_value=sp):
            result = tools.handle_add_to_playlist({
                "playlist_id": "pl123",
                "track_uri": "spotify:track:abc",
            })
        self.assertEqual(result["status"], "ok")
        sp.playlist_add_items.assert_called_once_with("pl123", ["spotify:track:abc"])


# ---------------------------------------------------------------------------
# handle_now_playing
# ---------------------------------------------------------------------------

class TestHandleNowPlaying(unittest.TestCase):
    """handle_now_playing: playing and idle states."""

    def test_nothing_playing_returns_playing_false(self):
        sp = _mock_client()
        sp.current_playback.return_value = None
        with patch("tools.get_client", return_value=sp):
            result = tools.handle_now_playing({})
        self.assertFalse(result["playing"])

    def test_no_item_returns_playing_false(self):
        sp = _mock_client()
        sp.current_playback.return_value = {"is_playing": True, "item": None}
        with patch("tools.get_client", return_value=sp):
            result = tools.handle_now_playing({})
        self.assertFalse(result["playing"])

    def test_returns_track_info(self):
        sp = _mock_client()
        sp.current_playback.return_value = {
            "is_playing": True,
            "progress_ms": 60000,
            "item": {
                "name": "Get Lucky",
                "uri": "spotify:track:getlucky",
                "artists": [{"name": "Daft Punk"}],
                "album": {"name": "Random Access Memories"},
                "duration_ms": 248000,
            },
            "device": {"name": "Living Room Speaker"},
        }
        with patch("tools.get_client", return_value=sp):
            result = tools.handle_now_playing({})
        self.assertTrue(result["playing"])
        self.assertEqual(result["track"], "Get Lucky")
        self.assertEqual(result["artist"], "Daft Punk")
        self.assertEqual(result["device"], "Living Room Speaker")

    def test_returns_episode_info(self):
        sp = _mock_client()
        sp.current_playback.return_value = {
            "is_playing": True,
            "progress_ms": 120000,
            "item": {
                "type": "episode",
                "name": "Episode 42",
                "uri": "spotify:episode:ep42",
                "duration_ms": 3600000,
                "show": {
                    "name": "Great Podcast",
                    "publisher": "Podcast Network",
                },
            },
            "device": {"name": "Kitchen Speaker"},
        }
        with patch("tools.get_client", return_value=sp):
            result = tools.handle_now_playing({})
        self.assertTrue(result["playing"])
        self.assertEqual(result["item_type"], "episode")
        self.assertEqual(result["track"], "Episode 42")
        self.assertEqual(result["album"], "Great Podcast")
        self.assertEqual(result["artist"], "Podcast Network")

    def test_client_exception_returns_error(self):
        with patch("tools.get_client", side_effect=RuntimeError("auth failed")):
            result = tools.handle_now_playing({})
        self.assertIn("error", result)


# ---------------------------------------------------------------------------
# handle_play
# ---------------------------------------------------------------------------

class TestHandlePlay(unittest.TestCase):
    """handle_play: URI routing and device_id forwarding."""

    def test_play_without_uri_resumes(self):
        sp = _mock_client()
        with patch("tools.get_client", return_value=sp):
            result = tools.handle_play({})
        self.assertEqual(result["status"], "ok")
        sp.start_playback.assert_called_once_with()

    def test_play_track_uri_uses_uris(self):
        sp = _mock_client()
        with patch("tools.get_client", return_value=sp):
            tools.handle_play({"uri": "spotify:track:abc"})
        _, kwargs = sp.start_playback.call_args
        self.assertIn("uris", kwargs)
        self.assertEqual(kwargs["uris"], ["spotify:track:abc"])

    def test_play_album_uri_uses_context_uri(self):
        sp = _mock_client()
        with patch("tools.get_client", return_value=sp):
            tools.handle_play({"uri": "spotify:album:xyz"})
        _, kwargs = sp.start_playback.call_args
        self.assertIn("context_uri", kwargs)

    def test_device_id_forwarded(self):
        sp = _mock_client()
        with patch("tools.get_client", return_value=sp):
            tools.handle_play({"device_id": "dev123"})
        _, kwargs = sp.start_playback.call_args
        self.assertEqual(kwargs.get("device_id"), "dev123")

    def test_exception_returns_error(self):
        with patch("tools.get_client", side_effect=RuntimeError("no device")):
            result = tools.handle_play({})
        self.assertIn("error", result)


# ---------------------------------------------------------------------------
# handle_pause / handle_next / handle_previous
# ---------------------------------------------------------------------------

class TestPlaybackControls(unittest.TestCase):
    """handle_pause, handle_next, handle_previous delegate correctly."""

    def test_pause_returns_ok(self):
        sp = _mock_client()
        with patch("tools.get_client", return_value=sp):
            result = tools.handle_pause({})
        self.assertEqual(result["status"], "ok")
        sp.pause_playback.assert_called_once()

    def test_next_returns_ok(self):
        sp = _mock_client()
        with patch("tools.get_client", return_value=sp):
            result = tools.handle_next({})
        self.assertEqual(result["status"], "ok")
        sp.next_track.assert_called_once()

    def test_previous_returns_ok(self):
        sp = _mock_client()
        with patch("tools.get_client", return_value=sp):
            result = tools.handle_previous({})
        self.assertEqual(result["status"], "ok")
        sp.previous_track.assert_called_once()

    def test_pause_exception_returns_error(self):
        with patch("tools.get_client", side_effect=RuntimeError("oops")):
            result = tools.handle_pause({})
        self.assertIn("error", result)


# ---------------------------------------------------------------------------
# handle_get_playlists
# ---------------------------------------------------------------------------

class TestHandleGetPlaylists(unittest.TestCase):
    """handle_get_playlists: result shaping."""

    def test_returns_playlists(self):
        sp = _mock_client()
        sp.current_user_playlists.return_value = {
            "items": [
                {"name": "Chill Mix", "id": "pl1", "uri": "spotify:playlist:pl1",
                 "tracks": {"total": 42}, "owner": {"display_name": "jeff"}},
            ]
        }
        with patch("tools.get_client", return_value=sp):
            result = tools.handle_get_playlists({})
        self.assertEqual(len(result["playlists"]), 1)
        pl = result["playlists"][0]
        self.assertEqual(pl["name"], "Chill Mix")
        self.assertEqual(pl["total_tracks"], 42)
        self.assertEqual(pl["owner"], "jeff")

    def test_empty_playlists(self):
        sp = _mock_client()
        sp.current_user_playlists.return_value = {"items": []}
        with patch("tools.get_client", return_value=sp):
            result = tools.handle_get_playlists({})
        self.assertEqual(result["playlists"], [])


# ---------------------------------------------------------------------------
# handle_get_devices
# ---------------------------------------------------------------------------

class TestHandleGetDevices(unittest.TestCase):
    """handle_get_devices: result shaping."""

    def test_returns_devices(self):
        sp = _mock_client()
        sp.devices.return_value = {
            "devices": [
                {"id": "dev1", "name": "Kitchen Echo", "type": "Speaker",
                 "is_active": True, "volume_percent": 50},
            ]
        }
        with patch("tools.get_client", return_value=sp):
            result = tools.handle_get_devices({})
        self.assertEqual(len(result["devices"]), 1)
        dev = result["devices"][0]
        self.assertEqual(dev["name"], "Kitchen Echo")
        self.assertTrue(dev["is_active"])

    def test_no_devices(self):
        sp = _mock_client()
        sp.devices.return_value = {"devices": []}
        with patch("tools.get_client", return_value=sp):
            result = tools.handle_get_devices({})
        self.assertEqual(result["devices"], [])


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------

class TestManifest(unittest.TestCase):
    """manifest() returns the expected structure."""

    def test_manifest_has_tools(self):
        m = tools.manifest()
        self.assertIn("tools", m)
        self.assertIsInstance(m["tools"], list)
        self.assertGreater(len(m["tools"]), 0)

    def test_manifest_has_expected_tools(self):
        names = {t["name"] for t in tools.manifest()["tools"]}
        expected = {
            "spotify_now_playing", "spotify_play", "spotify_pause",
            "spotify_next", "spotify_previous", "spotify_search",
            "spotify_add_to_playlist", "spotify_get_playlists", "spotify_get_devices",
        }
        self.assertEqual(names, expected)

    def test_each_tool_has_required_fields(self):
        for tool in tools.manifest()["tools"]:
            self.assertIn("name", tool)
            self.assertIn("description", tool)
            self.assertIn("input_schema", tool)


if __name__ == "__main__":
    unittest.main(verbosity=2)
