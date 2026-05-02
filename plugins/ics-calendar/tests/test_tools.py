"""Unit tests for the ics-calendar plugin (no network access required).

Covers:
  - parse_dt: various datetime string formats
  - parse_events: VEVENT block parsing and date filtering
  - handle_fetch: argument handling, env-var lookup, fetch+parse integration
  - manifest: structure validation
"""

import os
import sys
import unittest
from datetime import datetime
from unittest.mock import patch

_SRC_DIR = os.path.join(os.path.dirname(__file__), "..", "src")
sys.path.insert(0, _SRC_DIR)

from fetch_calendar import parse_dt, parse_events
import tools


# ---------------------------------------------------------------------------
# parse_dt
# ---------------------------------------------------------------------------

class TestParseDt(unittest.TestCase):
    """parse_dt handles the common ICS datetime formats."""

    def test_datetime_with_time(self):
        dt = parse_dt("20240315T090000")
        self.assertEqual(dt, datetime(2024, 3, 15, 9, 0, 0))

    def test_datetime_utc_suffix_stripped(self):
        dt = parse_dt("20240315T090000Z")
        self.assertEqual(dt, datetime(2024, 3, 15, 9, 0, 0))

    def test_date_only(self):
        dt = parse_dt("20240315")
        self.assertEqual(dt, datetime(2024, 3, 15, 0, 0, 0))

    def test_tzid_prefixed_value(self):
        # ICS lines like "DTSTART;TZID=America/New_York:20240315T090000"
        # The partition splits on ":" so the value part is "20240315T090000"
        dt = parse_dt("America/New_York:20240315T090000")
        self.assertEqual(dt, datetime(2024, 3, 15, 9, 0, 0))

    def test_invalid_returns_none(self):
        dt = parse_dt("not-a-date")
        self.assertIsNone(dt)

    def test_whitespace_stripped(self):
        dt = parse_dt("  20240315  ")
        self.assertEqual(dt, datetime(2024, 3, 15, 0, 0, 0))


# ---------------------------------------------------------------------------
# parse_events
# ---------------------------------------------------------------------------

ICS_SAMPLE = """BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
SUMMARY:Team Meeting
DTSTART:20260320T100000Z
DTEND:20260320T110000Z
LOCATION:Conference Room A
END:VEVENT
BEGIN:VEVENT
SUMMARY:Doctor Appointment
DTSTART:20260322T090000Z
DTEND:20260322T095000Z
LOCATION:Medical Center
END:VEVENT
BEGIN:VEVENT
SUMMARY:Old Event
DTSTART:20260301T120000Z
DTEND:20260301T130000Z
END:VEVENT
END:VCALENDAR"""


class TestParseEvents(unittest.TestCase):
    """parse_events extracts and filters VEVENT blocks correctly."""

    def test_returns_events_within_range(self):
        start = datetime(2026, 3, 18)
        end = datetime(2026, 3, 25)
        events = parse_events(ICS_SAMPLE, start, end)
        self.assertEqual(len(events), 2)
        summaries = [e["SUMMARY"] for e in events]
        self.assertIn("Team Meeting", summaries)
        self.assertIn("Doctor Appointment", summaries)

    def test_excludes_events_before_range(self):
        start = datetime(2026, 3, 18)
        end = datetime(2026, 3, 25)
        events = parse_events(ICS_SAMPLE, start, end)
        summaries = [e["SUMMARY"] for e in events]
        self.assertNotIn("Old Event", summaries)

    def test_returns_location(self):
        start = datetime(2026, 3, 18)
        end = datetime(2026, 3, 25)
        events = parse_events(ICS_SAMPLE, start, end)
        meeting = next(e for e in events if e["SUMMARY"] == "Team Meeting")
        self.assertEqual(meeting["LOCATION"], "Conference Room A")

    def test_empty_ics_returns_empty_list(self):
        events = parse_events("BEGIN:VCALENDAR\nEND:VCALENDAR", datetime(2026, 1, 1), datetime(2026, 12, 31))
        self.assertEqual(events, [])

    def test_event_without_dtstart_excluded(self):
        ics = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:No Date\nEND:VEVENT\nEND:VCALENDAR"
        events = parse_events(ics, datetime(2026, 1, 1), datetime(2026, 12, 31))
        self.assertEqual(events, [])

    def test_start_inclusive_end_exclusive(self):
        # Event exactly on start_dt should be included; one at end_dt should not
        ics = """BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:At Start
DTSTART:20260318T000000Z
DTEND:20260318T010000Z
END:VEVENT
BEGIN:VEVENT
SUMMARY:At End
DTSTART:20260325T000000Z
DTEND:20260325T010000Z
END:VEVENT
END:VCALENDAR"""
        start = datetime(2026, 3, 18)
        end = datetime(2026, 3, 25)
        events = parse_events(ics, start, end)
        summaries = [e["SUMMARY"] for e in events]
        self.assertIn("At Start", summaries)
        self.assertNotIn("At End", summaries)


# ---------------------------------------------------------------------------
# handle_fetch
# ---------------------------------------------------------------------------

FAKE_ICS = """BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Future Event
DTSTART:20991231T120000Z
DTEND:20991231T130000Z
LOCATION:Somewhere
END:VEVENT
END:VCALENDAR"""


class TestHandleFetch(unittest.TestCase):
    """handle_fetch: argument handling and integration with fetch_ics/parse_events."""

    def test_missing_url_and_missing_calendar_id_returns_error(self):
        result = tools.handle_fetch({})
        self.assertIn("error", result)

    def test_uses_provided_url(self):
        with patch("tools.fetch_ics", return_value=FAKE_ICS):
            result = tools.handle_fetch({"url": "http://example.com/cal.ics", "days": 36500})
        self.assertNotIn("error", result)
        self.assertEqual(result["event_count"], 1)

    def test_uses_configured_calendar(self):
        plugin_config = {
            "calendars": [
                {"id": "family", "label": "Family", "url": "http://example.com/family.ics"}
            ]
        }
        with patch("tools.fetch_ics", return_value=FAKE_ICS):
            result = tools.handle_fetch({"calendar_id": "family", "days": 36500}, plugin_config)
        self.assertNotIn("error", result)
        self.assertEqual(result["calendar_id"], "family")

    def test_fetch_failure_returns_error(self):
        plugin_config = {
            "calendars": [
                {"id": "broken", "url": "http://bad.example.com/"}
            ]
        }
        with patch("tools.fetch_ics", return_value=None):
            result = tools.handle_fetch({"calendar_id": "broken"}, plugin_config)
        self.assertIn("error", result)

    def test_returns_event_list(self):
        with patch("tools.fetch_ics", return_value=FAKE_ICS):
            result = tools.handle_fetch({"url": "http://example.com/cal.ics", "days": 36500})
        self.assertIn("events", result)
        self.assertIsInstance(result["events"], list)

    def test_label_derived_from_calendar_id(self):
        plugin_config = {
            "calendars": [
                {"id": "family_trip", "url": "http://example.com/family.ics"}
            ]
        }
        with patch("tools.fetch_ics", return_value=FAKE_ICS):
            result = tools.handle_fetch({"calendar_id": "family_trip", "days": 36500}, plugin_config)
        self.assertIn("Family Trip", result["text"])

    def test_configured_label_used_in_output(self):
        plugin_config = {
            "calendars": [
                {"id": "tripit", "label": "TripIt", "url": "http://example.com/tripit.ics"}
            ]
        }
        with patch("tools.fetch_ics", return_value=FAKE_ICS):
            result = tools.handle_fetch({"calendar_id": "tripit", "days": 36500}, plugin_config)
        self.assertIn("TripIt", result["text"])

    def test_custom_label_used_in_output(self):
        with patch("tools.fetch_ics", return_value=FAKE_ICS):
            result = tools.handle_fetch({
                "url": "http://example.com/cal.ics",
                "label": "My Custom Calendar",
                "days": 36500,
            })
        self.assertIn("My Custom Calendar", result["text"])

    def test_unknown_calendar_id_returns_error(self):
        result = tools.handle_fetch({"calendar_id": "missing"}, {"calendars": []})
        self.assertIn("error", result)


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

    def test_manifest_has_ics_calendar_fetch(self):
        m = tools.manifest()
        names = {t["name"] for t in m["tools"]}
        self.assertIn("ics_calendar_fetch", names)

    def test_each_tool_has_required_fields(self):
        for tool in tools.manifest()["tools"]:
            self.assertIn("name", tool)
            self.assertIn("description", tool)
            self.assertIn("input_schema", tool)


if __name__ == "__main__":
    unittest.main(verbosity=2)
