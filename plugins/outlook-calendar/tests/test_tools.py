"""Unit tests for the outlook-calendar plugin (no network access required).

Covers:
  - utc_to_local: UTC datetime string conversion (format validation)
  - format_event: event dict → formatted output
  - handle_fetch: mocked fetch_calendar, HTTP/runtime error handling
  - manifest: structure validation
"""

import os
import sys
import unittest
import urllib.error
from datetime import datetime
from unittest.mock import patch

_SRC_DIR = os.path.join(os.path.dirname(__file__), "..", "src")
sys.path.insert(0, _SRC_DIR)

# Provide dummy env vars so the module can be imported without crashing
os.environ.setdefault("OUTLOOK_CLIENT_ID", "test-id")
os.environ.setdefault("OUTLOOK_CLIENT_SECRET", "test-secret")
os.environ.setdefault("OUTLOOK_REFRESH_TOKEN", "test-refresh")

from fetch_calendar import utc_to_local, format_event, _calendar_search_names
import tools


# ---------------------------------------------------------------------------
# utc_to_local
# ---------------------------------------------------------------------------

class TestUtcToLocal(unittest.TestCase):
    """utc_to_local converts Graph API UTC strings to local datetime strings."""

    def test_valid_utc_returns_string(self):
        result = utc_to_local("2026-03-15T14:30:00")
        # Should return a non-empty string in some local date/time format
        self.assertIsInstance(result, str)
        self.assertTrue(len(result) > 0)

    def test_invalid_falls_back_to_truncation(self):
        # Malformed input should fall back to the first 16 chars
        result = utc_to_local("not-a-datetime-string")
        self.assertEqual(result, "not-a-datetime-s")

    def test_short_input_handled(self):
        result = utc_to_local("2026-03-15T14:30:00Z")
        self.assertIsInstance(result, str)


# ---------------------------------------------------------------------------
# format_event
# ---------------------------------------------------------------------------

def _event(**overrides):
    base = {
        "subject": "Sprint Review",
        "start": {"dateTime": "2026-03-15T10:00:00", "timeZone": "UTC"},
        "end": {"dateTime": "2026-03-15T11:00:00", "timeZone": "UTC"},
        "location": {"displayName": "Conference Room B"},
    }
    base.update(overrides)
    return base


class TestFormatEvent(unittest.TestCase):
    """format_event shapes a Graph API event dict into a display-friendly dict."""

    def test_returns_dict(self):
        result = format_event(_event())
        self.assertIsInstance(result, dict)

    def test_has_expected_keys(self):
        result = format_event(_event())
        self.assertIn("subject", result)
        self.assertIn("start", result)
        self.assertIn("end", result)
        self.assertIn("location", result)

    def test_subject_preserved(self):
        result = format_event(_event(subject="All Hands"))
        self.assertEqual(result["subject"], "All Hands")

    def test_location_preserved(self):
        result = format_event(_event())
        self.assertEqual(result["location"], "Conference Room B")

    def test_missing_location_defaults(self):
        result = format_event(_event(location={}))
        self.assertEqual(result["location"], "No location")

    def test_non_utc_timezone_uses_raw_truncated(self):
        e = _event()
        e["start"] = {"dateTime": "2026-03-15T10:00:00", "timeZone": "Pacific Standard Time"}
        e["end"] = {"dateTime": "2026-03-15T11:00:00", "timeZone": "Pacific Standard Time"}
        result = format_event(e)
        # Non-UTC: raw truncated to 16 chars
        self.assertEqual(result["start"], "2026-03-15T10:00")
        self.assertEqual(result["end"], "2026-03-15T11:00")

    def test_no_subject_defaults(self):
        e = {
            "start": {"dateTime": "2026-03-15T10:00:00", "timeZone": "UTC"},
            "end": {"dateTime": "2026-03-15T11:00:00", "timeZone": "UTC"},
            "location": {"displayName": ""},
        }
        result = format_event(e)
        self.assertEqual(result["subject"], "No subject")


# ---------------------------------------------------------------------------
# handle_fetch
# ---------------------------------------------------------------------------

FAKE_CALENDAR_RESULT = {
    "personal": {
        "label": "Personal",
        "count": 2,
        "start_date": "2026-03-15",
        "end_date": "2026-03-22",
        "events": [
            {"subject": "Dentist", "start": "2026-03-16 9:00 AM", "end": "2026-03-16 10:00 AM", "location": "Dental Office"},
        ],
    }
}


class TestHandleFetch(unittest.TestCase):
    """handle_fetch delegates to fetch_calendar and handles errors."""

    @patch("tools.fetch_calendar", return_value=FAKE_CALENDAR_RESULT)
    def test_returns_calendar_data(self, _mock):
        result = tools.handle_fetch({})
        self.assertNotIn("error", result)
        self.assertIn("personal", result)

    @patch("tools.fetch_calendar", return_value=FAKE_CALENDAR_RESULT)
    def test_passes_calendar_arg(self, mock_fetch):
        tools.handle_fetch({"calendar": "personal", "days": 14})
        mock_fetch.assert_called_once_with(calendar="personal", days=14)

    @patch("tools.fetch_calendar", return_value=FAKE_CALENDAR_RESULT)
    def test_defaults_calendar_all(self, mock_fetch):
        tools.handle_fetch({})
        mock_fetch.assert_called_once_with(calendar="all", days=7)

    def test_http_error_returns_error_dict(self):
        err = urllib.error.HTTPError(url="u", code=401, msg="Unauthorized", hdrs=None, fp=None)
        err.read = lambda: b"token expired"
        with patch("tools.fetch_calendar", side_effect=err):
            result = tools.handle_fetch({})
        self.assertIn("error", result)
        self.assertIn("401", result["error"])

    def test_runtime_error_returns_error_dict(self):
        with patch("tools.fetch_calendar", side_effect=RuntimeError("OUTLOOK_CLIENT_ID not set")):
            result = tools.handle_fetch({})
        self.assertIn("error", result)
        self.assertIn("OUTLOOK_CLIENT_ID", result["error"])


# ---------------------------------------------------------------------------
# _calendar_search_names
# ---------------------------------------------------------------------------

class TestCalendarSearchNames(unittest.TestCase):
    """_calendar_search_names returns defaults plus env-var extras."""

    def test_personal_defaults_no_env(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("OUTLOOK_PERSONAL_CALENDAR_NAMES", None)
            result = _calendar_search_names("personal")
        self.assertEqual(result, ["calendar", "personal"])

    def test_personal_defaults_do_not_contain_jeff(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("OUTLOOK_PERSONAL_CALENDAR_NAMES", None)
            result = _calendar_search_names("personal")
        self.assertNotIn("jeff", result)

    def test_family_defaults_no_env(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("OUTLOOK_FAMILY_CALENDAR_NAMES", None)
            result = _calendar_search_names("family")
        self.assertEqual(result, ["family v2", "your family", "family"])

    def test_personal_env_prepends_extras(self):
        with patch.dict(os.environ, {"OUTLOOK_PERSONAL_CALENDAR_NAMES": "jeff,work cal"}):
            result = _calendar_search_names("personal")
        self.assertEqual(result, ["jeff", "work cal", "calendar", "personal"])

    def test_family_env_prepends_extras(self):
        with patch.dict(os.environ, {"OUTLOOK_FAMILY_CALENDAR_NAMES": "shared"}):
            result = _calendar_search_names("family")
        self.assertEqual(result[:1], ["shared"])
        self.assertIn("family v2", result)

    def test_env_strips_whitespace_and_lowercases(self):
        with patch.dict(os.environ, {"OUTLOOK_PERSONAL_CALENDAR_NAMES": " Jeff , My Cal "}):
            result = _calendar_search_names("personal")
        self.assertEqual(result[:2], ["jeff", "my cal"])

    def test_empty_env_returns_defaults(self):
        with patch.dict(os.environ, {"OUTLOOK_PERSONAL_CALENDAR_NAMES": ""}):
            result = _calendar_search_names("personal")
        self.assertEqual(result, ["calendar", "personal"])


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

    def test_manifest_has_outlook_calendar_fetch(self):
        names = {t["name"] for t in tools.manifest()["tools"]}
        self.assertIn("outlook_calendar_fetch", names)

    def test_each_tool_has_required_fields(self):
        for tool in tools.manifest()["tools"]:
            self.assertIn("name", tool)
            self.assertIn("description", tool)
            self.assertIn("input_schema", tool)


if __name__ == "__main__":
    unittest.main(verbosity=2)
