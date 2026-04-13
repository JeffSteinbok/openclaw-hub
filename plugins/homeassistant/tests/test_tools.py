"""Unit tests for the homeassistant plugin tools.

These tests exercise pure logic (no network / hass-cli access required):
  - tools.py manifest and dispatch
  - ha_person_find: argument validation and name-matching logic
  - ha_speaker_volume_get: argument handling
  - ha_speaker_volume_set: argument validation (missing, out-of-range, non-numeric)
  - _extract_volume_info helper
"""

import os
import sys
import unittest
from unittest.mock import patch

# Ensure the src directory is importable
_SRC_DIR = os.path.join(os.path.dirname(__file__), "..", "src")
sys.path.insert(0, _SRC_DIR)

# Provide a dummy token so _preflight() doesn't complain at import time
os.environ.setdefault("HASS_TOKEN", "test-token")

import tools  # noqa: E402


# ---------------------------------------------------------------------------
# Manifest / dispatch
# ---------------------------------------------------------------------------

class TestManifest(unittest.TestCase):
    """tools.manifest() returns the expected structure."""

    def test_manifest_has_all_tools(self):
        m = tools.manifest()
        names = {t["name"] for t in m["tools"]}
        expected = {
            "hass_state_get",
            "hass_state_list",
            "hass_service_call",
            "hass_event_list",
            "hass_person_find",
            "hass_speaker_volume_get",
            "hass_speaker_volume_set",
            "hass_camera_list",
            "hass_camera_collage",
            "hass_camera_snapshot",
            "hass_logbook",
        }
        self.assertEqual(names, expected)

    def test_each_tool_has_required_fields(self):
        m = tools.manifest()
        for tool in m["tools"]:
            self.assertIn("name", tool)
            self.assertIn("description", tool)
            self.assertIn("input_schema", tool)
            self.assertIsInstance(tool["description"], str)
            self.assertIsInstance(tool["input_schema"], dict)

    def test_unknown_tool_returns_error(self):
        result = tools.call("nonexistent_tool", {})
        self.assertIn("error", result)


# ---------------------------------------------------------------------------
# ha_person_find
# ---------------------------------------------------------------------------

class TestHandlePersonFind(unittest.TestCase):
    """handle_person_find validation and name-search logic."""

    def test_missing_both_args_returns_error(self):
        result = tools.handle_person_find({})
        self.assertIn("error", result)

    def test_entity_id_triggers_direct_lookup(self):
        """When entity_id is provided, _api_get is called with the entity state path."""
        fake_entity = {
            "entity_id": "person.john",
            "state": "home",
            "attributes": {"friendly_name": "John"},
        }
        with patch("tools._api_get", return_value={"output": fake_entity}) as mock_run:
            result = tools.handle_person_find({"entity_id": "person.john"})
        mock_run.assert_called_once_with("/api/states/person.john")
        self.assertIn("output", result)

    def test_name_match_by_friendly_name(self):
        fake_persons = [
            {
                "entity_id": "person.alice",
                "state": "home",
                "attributes": {"friendly_name": "Alice"},
            },
            {
                "entity_id": "person.bob",
                "state": "away",
                "attributes": {"friendly_name": "Bob"},
            },
        ]
        with patch("tools._api_get", return_value={"output": fake_persons}):
            result = tools.handle_person_find({"name": "alice"})
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["output"][0]["entity_id"], "person.alice")

    def test_name_match_case_insensitive(self):
        fake_persons = [
            {
                "entity_id": "person.alice",
                "state": "home",
                "attributes": {"friendly_name": "Alice"},
            },
        ]
        with patch("tools._api_get", return_value={"output": fake_persons}):
            result = tools.handle_person_find({"name": "ALICE"})
        self.assertEqual(result["count"], 1)

    def test_name_match_by_entity_id_substring(self):
        fake_persons = [
            {
                "entity_id": "person.charlie",
                "state": "away",
                "attributes": {"friendly_name": "Charlie"},
            },
        ]
        with patch("tools._api_get", return_value={"output": fake_persons}):
            result = tools.handle_person_find({"name": "charlie"})
        self.assertEqual(result["count"], 1)

    def test_name_no_match_returns_empty(self):
        fake_persons = [
            {
                "entity_id": "person.alice",
                "state": "home",
                "attributes": {"friendly_name": "Alice"},
            },
        ]
        with patch("tools._api_get", return_value={"output": fake_persons}):
            result = tools.handle_person_find({"name": "zzznonexistent"})
        self.assertEqual(result["count"], 0)
        self.assertEqual(result["output"], [])
        self.assertIn("message", result)

    def test_preflight_error_propagated(self):
        with patch("tools._api_get", return_value={"error": "Pre-flight check failed"}):
            result = tools.handle_person_find({"name": "alice"})
        self.assertIn("error", result)


# ---------------------------------------------------------------------------
# _extract_volume_info
# ---------------------------------------------------------------------------

class TestExtractVolumeInfo(unittest.TestCase):
    """_extract_volume_info returns the expected keys."""

    def test_extracts_volume_fields(self):
        entity = {
            "entity_id": "media_player.living_room",
            "state": "playing",
            "attributes": {
                "friendly_name": "Living Room Speaker",
                "volume_level": 0.45,
                "is_volume_muted": False,
            },
        }
        result = tools._extract_volume_info(entity)
        self.assertEqual(result["entity_id"], "media_player.living_room")
        self.assertEqual(result["friendly_name"], "Living Room Speaker")
        self.assertEqual(result["state"], "playing")
        self.assertAlmostEqual(result["volume_level"], 0.45)
        self.assertFalse(result["is_volume_muted"])

    def test_non_dict_passthrough(self):
        self.assertEqual(tools._extract_volume_info("not-a-dict"), "not-a-dict")

    def test_missing_attributes_return_none(self):
        entity = {"entity_id": "media_player.x", "state": "idle", "attributes": {}}
        result = tools._extract_volume_info(entity)
        self.assertIsNone(result["volume_level"])
        self.assertIsNone(result["is_volume_muted"])


# ---------------------------------------------------------------------------
# ha_speaker_volume_get
# ---------------------------------------------------------------------------

class TestHandleSpeakerVolumeGet(unittest.TestCase):
    """handle_speaker_volume_get with and without entity_id."""

    def _make_player(self, eid, volume):
        return {
            "entity_id": eid,
            "state": "idle",
            "attributes": {"friendly_name": eid, "volume_level": volume, "is_volume_muted": False},
        }

    def test_get_single_speaker(self):
        entity = self._make_player("media_player.kitchen", 0.3)
        with patch("tools._api_get", return_value={"output": entity}) as mock_run:
            result = tools.handle_speaker_volume_get({"entity_id": "media_player.kitchen"})
        mock_run.assert_called_once_with("/api/states/media_player.kitchen")
        self.assertIn("output", result)
        self.assertAlmostEqual(result["output"]["volume_level"], 0.3)

    def test_get_all_speakers(self):
        entities = [
            self._make_player("media_player.living_room", 0.5),
            self._make_player("media_player.kitchen", 0.2),
        ]
        with patch("tools._api_get", return_value={"output": entities}) as mock_run:
            result = tools.handle_speaker_volume_get({})
        mock_run.assert_called_once_with("/api/states", timeout=30)
        self.assertEqual(result["count"], 2)
        self.assertEqual(len(result["output"]), 2)

    def test_error_propagated(self):
        with patch("tools._api_get", return_value={"error": "Pre-flight check failed"}):
            result = tools.handle_speaker_volume_get({"entity_id": "media_player.x"})
        self.assertIn("error", result)


# ---------------------------------------------------------------------------
# ha_speaker_volume_set
# ---------------------------------------------------------------------------

class TestHandleSpeakerVolumeSet(unittest.TestCase):
    """handle_speaker_volume_set validation."""

    def test_missing_entity_id_returns_error(self):
        result = tools.handle_speaker_volume_set({"volume_level": 0.5})
        self.assertIn("error", result)

    def test_missing_volume_level_returns_error(self):
        result = tools.handle_speaker_volume_set({"entity_id": "media_player.living_room"})
        self.assertIn("error", result)

    def test_volume_too_high_returns_error(self):
        result = tools.handle_speaker_volume_set(
            {"entity_id": "media_player.living_room", "volume_level": 1.5}
        )
        self.assertIn("error", result)

    def test_volume_too_low_returns_error(self):
        result = tools.handle_speaker_volume_set(
            {"entity_id": "media_player.living_room", "volume_level": -0.1}
        )
        self.assertIn("error", result)

    def test_non_numeric_volume_returns_error(self):
        result = tools.handle_speaker_volume_set(
            {"entity_id": "media_player.living_room", "volume_level": "loud"}
        )
        self.assertIn("error", result)

    def test_valid_call_invokes_service(self):
        with patch("tools._api_post", return_value={"output": "ok"}) as mock_run:
            result = tools.handle_speaker_volume_set(
                {"entity_id": "media_player.living_room", "volume_level": 0.6}
            )
        mock_run.assert_called_once_with(
            "/api/services/media_player/volume_set",
            body={"entity_id": "media_player.living_room", "volume_level": 0.6},
        )
        self.assertEqual(result, {"output": "ok"})

    def test_boundary_zero_is_valid(self):
        with patch("tools._api_post", return_value={"output": "ok"}):
            result = tools.handle_speaker_volume_set(
                {"entity_id": "media_player.living_room", "volume_level": 0.0}
            )
        self.assertNotIn("error", result)

    def test_boundary_one_is_valid(self):
        with patch("tools._api_post", return_value={"output": "ok"}):
            result = tools.handle_speaker_volume_set(
                {"entity_id": "media_player.living_room", "volume_level": 1.0}
            )
        self.assertNotIn("error", result)

    def test_string_numeric_volume_is_coerced(self):
        """Numeric strings like '0.5' should be accepted."""
        with patch("tools._api_post", return_value={"output": "ok"}):
            result = tools.handle_speaker_volume_set(
                {"entity_id": "media_player.living_room", "volume_level": "0.5"}
            )
        self.assertNotIn("error", result)


if __name__ == "__main__":
    unittest.main(verbosity=2)
