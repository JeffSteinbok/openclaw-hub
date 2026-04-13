"""Unit tests for the outlook-work-calendar plugin (no network access required).

Covers:
  - format_date: datetime → ISO 8601 string
  - parse_date_string: string → datetime
  - build_request_body: EWS JSON request construction
  - extract_events: nested response parsing
  - format_event: human-readable Markdown snippet
  - handle_fetch: missing env var, mocked fetch_calendar
  - manifest: structure validation
"""

import os
import sys
import unittest
from datetime import datetime
from unittest.mock import patch

_SRC_DIR = os.path.join(os.path.dirname(__file__), "..", "src")
sys.path.insert(0, _SRC_DIR)

# Provide a dummy value so module-level code that reads the env var won't
# produce unexpected side-effects during import.
os.environ.setdefault("OUTLOOK_WORK_CALENDAR_URL", "http://test.example.com")
os.environ.setdefault("OUTLOOK_WORK_FOLDER_ID", "test-folder-id")

from fetch_calendar import (
    format_date,
    parse_date_string,
    build_request_body,
    extract_events,
    format_event,
)
import tools


# ---------------------------------------------------------------------------
# format_date
# ---------------------------------------------------------------------------

class TestFormatDate(unittest.TestCase):
    """format_date converts a datetime to ISO 8601 with milliseconds."""

    def test_basic_format(self):
        dt = datetime(2026, 3, 15, 9, 30, 0)
        self.assertEqual(format_date(dt), "2026-03-15T09:30:00.000")

    def test_midnight(self):
        dt = datetime(2026, 1, 1, 0, 0, 0)
        self.assertEqual(format_date(dt), "2026-01-01T00:00:00.000")

    def test_end_of_day(self):
        dt = datetime(2026, 12, 31, 23, 59, 59)
        self.assertEqual(format_date(dt), "2026-12-31T23:59:59.000")


# ---------------------------------------------------------------------------
# parse_date_string
# ---------------------------------------------------------------------------

class TestParseDateString(unittest.TestCase):
    """parse_date_string converts YYYY-MM-DD strings to datetime objects."""

    def test_basic_date(self):
        dt = parse_date_string("2026-03-15")
        self.assertEqual(dt, datetime(2026, 3, 15, 0, 0, 0))

    def test_start_of_year(self):
        dt = parse_date_string("2026-01-01")
        self.assertEqual(dt, datetime(2026, 1, 1))

    def test_invalid_raises(self):
        with self.assertRaises(ValueError):
            parse_date_string("not-a-date")


# ---------------------------------------------------------------------------
# build_request_body
# ---------------------------------------------------------------------------

class TestBuildRequestBody(unittest.TestCase):
    """build_request_body constructs a valid EWS FindItem JSON payload."""

    def setUp(self):
        self.body = build_request_body("2026-03-15T00:00:00.000", "2026-03-22T00:00:00.000")

    def test_top_level_type(self):
        self.assertEqual(self.body["__type"], "FindItemJsonRequest:#Exchange")

    def test_has_header(self):
        self.assertIn("Header", self.body)
        self.assertEqual(self.body["Header"]["__type"], "JsonRequestHeaders:#Exchange")

    def test_has_body(self):
        self.assertIn("Body", self.body)
        self.assertEqual(self.body["Body"]["__type"], "FindItemRequest:#Exchange")

    def test_paging_dates(self):
        paging = self.body["Body"]["Paging"]
        self.assertEqual(paging["StartDate"], "2026-03-15T00:00:00.000")
        self.assertEqual(paging["EndDate"], "2026-03-22T00:00:00.000")

    def test_traversal_shallow(self):
        self.assertEqual(self.body["Body"]["Traversal"], "Shallow")

    def test_timezone_in_header(self):
        tz = self.body["Header"]["TimeZoneContext"]["TimeZoneDefinition"]["Id"]
        self.assertEqual(tz, "Pacific Standard Time")


# ---------------------------------------------------------------------------
# extract_events
# ---------------------------------------------------------------------------

SAMPLE_RESPONSE = {
    "Body": {
        "ResponseMessages": {
            "Items": [
                {
                    "RootFolder": {
                        "Items": [
                            {"Subject": "Sprint Planning", "Start": "2026-03-16T10:00:00",
                             "End": "2026-03-16T11:00:00", "Location": {"DisplayName": "Room 101"},
                             "FreeBusyType": "Busy", "IsAllDayEvent": False, "Sensitivity": "Normal"},
                            {"Subject": "1:1", "Start": "2026-03-17T14:00:00",
                             "End": "2026-03-17T14:30:00", "Location": {"DisplayName": ""},
                             "FreeBusyType": "Busy", "IsAllDayEvent": False, "Sensitivity": "Normal"},
                        ]
                    }
                }
            ]
        }
    }
}


class TestExtractEvents(unittest.TestCase):
    """extract_events navigates the nested EWS response structure."""

    def test_returns_list_of_events(self):
        events = extract_events(SAMPLE_RESPONSE)
        self.assertIsInstance(events, list)
        self.assertEqual(len(events), 2)

    def test_event_subjects(self):
        events = extract_events(SAMPLE_RESPONSE)
        subjects = [e["Subject"] for e in events]
        self.assertIn("Sprint Planning", subjects)
        self.assertIn("1:1", subjects)

    def test_empty_response_returns_empty_list(self):
        self.assertEqual(extract_events({}), [])
        self.assertEqual(extract_events({"Body": {}}), [])

    def test_missing_items_returns_empty_list(self):
        bad = {"Body": {"ResponseMessages": {"Items": [{"RootFolder": {}}]}}}
        self.assertEqual(extract_events(bad), [])


# ---------------------------------------------------------------------------
# format_event
# ---------------------------------------------------------------------------

class TestFormatEvent(unittest.TestCase):
    """format_event produces human-readable Markdown for a single event."""

    def _event(self, **overrides):
        base = {
            "Subject": "Team Sync",
            "Start": "2026-03-16T10:00:00",
            "End": "2026-03-16T11:00:00",
            "Location": {"DisplayName": "Zoom"},
            "FreeBusyType": "Busy",
            "IsAllDayEvent": False,
            "Sensitivity": "Normal",
        }
        base.update(overrides)
        return base

    def test_contains_subject(self):
        result = format_event(self._event())
        self.assertIn("Team Sync", result)

    def test_contains_time(self):
        result = format_event(self._event())
        self.assertIn("2026-03-16T10:00:00", result)

    def test_private_badge(self):
        result = format_event(self._event(Sensitivity="Private"))
        self.assertIn("[PRIVATE]", result)

    def test_all_day_badge(self):
        result = format_event(self._event(IsAllDayEvent=True))
        self.assertIn("[ALL DAY]", result)

    def test_no_badges_for_normal_event(self):
        result = format_event(self._event())
        self.assertNotIn("[PRIVATE]", result)
        self.assertNotIn("[ALL DAY]", result)

    def test_location_displayed(self):
        result = format_event(self._event())
        self.assertIn("Zoom", result)

    def test_empty_location_shows_label(self):
        result = format_event(self._event(Location={"DisplayName": ""}))
        self.assertIn("Location:", result)


# ---------------------------------------------------------------------------
# handle_fetch (tools.py)
# ---------------------------------------------------------------------------

class TestHandleFetch(unittest.TestCase):
    """handle_fetch delegates to fetch_calendar and formats the response."""

    def test_missing_env_var_returns_error(self):
        os.environ.pop("OUTLOOK_WORK_CALENDAR_URL", None)
        # Patch _require_base_url to simulate a sys.exit(1) via SystemExit
        with patch("tools.fetch_calendar", side_effect=SystemExit(1)):
            result = tools.handle_fetch({})
        self.assertIn("error", result)
        # Restore for other tests
        os.environ["OUTLOOK_WORK_CALENDAR_URL"] = "http://test.example.com"

    def test_returns_formatted_text(self):
        with patch("tools.fetch_calendar", return_value=SAMPLE_RESPONSE), \
             patch("tools.extract_events", return_value=SAMPLE_RESPONSE["Body"]["ResponseMessages"]["Items"][0]["RootFolder"]["Items"]), \
             patch("tools.format_event", return_value="\n  📅 Sprint Planning\n"):
            result = tools.handle_fetch({})
        self.assertIn("text", result)
        self.assertIn("event_count", result)

    def test_event_count_matches(self):
        events = SAMPLE_RESPONSE["Body"]["ResponseMessages"]["Items"][0]["RootFolder"]["Items"]
        with patch("tools.fetch_calendar", return_value=SAMPLE_RESPONSE), \
             patch("tools.extract_events", return_value=events), \
             patch("tools.format_event", return_value="\n  📅 Event\n"):
            result = tools.handle_fetch({"days": 7})
        self.assertEqual(result["event_count"], 2)

    def test_empty_calendar_returns_zero_events(self):
        with patch("tools.fetch_calendar", return_value={}), \
             patch("tools.extract_events", return_value=[]):
            result = tools.handle_fetch({})
        self.assertEqual(result["event_count"], 0)


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

    def test_manifest_has_work_calendar_fetch(self):
        names = {t["name"] for t in tools.manifest()["tools"]}
        self.assertIn("outlook_work_calendar_fetch", names)

    def test_each_tool_has_required_fields(self):
        for tool in tools.manifest()["tools"]:
            self.assertIn("name", tool)
            self.assertIn("description", tool)
            self.assertIn("input_schema", tool)


if __name__ == "__main__":
    unittest.main(verbosity=2)
