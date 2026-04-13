"""Unit tests for the fastmail plugin.

These tests exercise pure logic (no network access required):
  - Duration-to-minutes helper
  - iCalendar text escaping and VEVENT building
  - CalDAV client: XML helpers, iCalendar parsing, VEVENT patching
  - RSVP state helpers (load/save/update)
  - tools.py manifest and dispatch

Tests that require live credentials are intentionally excluded.
"""

import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone

# Ensure the src directory is importable
_SRC_DIR = os.path.join(os.path.dirname(__file__), "..", "src")
sys.path.insert(0, _SRC_DIR)

# Set required env vars before importing modules that read them at import time
os.environ.setdefault("FASTMAIL_ACCOUNT_ID", "test-account")
os.environ.setdefault("FASTMAIL_JMAP_TOKEN", "test-token")

import fastmail  # noqa: E402
import caldav_client  # noqa: E402
from caldav_client import (  # noqa: E402
    CalDAVClient,
    CalDAVError,
    parse_ical_event,
    update_ical_vevent,
)
import tools  # noqa: E402


# ── Duration helpers ──────────────────────────────────────────────────────────

class TestDurationToMinutes(unittest.TestCase):
    """fastmail.duration_to_minutes"""

    def test_hours(self):
        self.assertEqual(fastmail.duration_to_minutes("1h"), 60)
        self.assertEqual(fastmail.duration_to_minutes("2h"), 120)

    def test_minutes(self):
        self.assertEqual(fastmail.duration_to_minutes("30m"), 30)
        self.assertEqual(fastmail.duration_to_minutes("90m"), 90)

    def test_fractional_hours(self):
        self.assertEqual(fastmail.duration_to_minutes("1.5h"), 90)

    def test_bare_number(self):
        self.assertEqual(fastmail.duration_to_minutes("45"), 45)

    def test_invalid_raises_sysexit(self):
        with self.assertRaises(SystemExit):
            fastmail.duration_to_minutes("xyz")


# ── iCalendar helpers ─────────────────────────────────────────────────────────

class TestIcalEscape(unittest.TestCase):
    """fastmail.ical_escape"""

    def test_no_special_chars(self):
        self.assertEqual(fastmail.ical_escape("Hello World"), "Hello World")

    def test_backslash(self):
        self.assertEqual(fastmail.ical_escape("a\\b"), "a\\\\b")

    def test_semicolon(self):
        self.assertEqual(fastmail.ical_escape("a;b"), "a\\;b")

    def test_comma(self):
        self.assertEqual(fastmail.ical_escape("a,b"), "a\\,b")

    def test_newline(self):
        self.assertEqual(fastmail.ical_escape("a\nb"), "a\\nb")

    def test_combined(self):
        self.assertEqual(fastmail.ical_escape("a;b,c\nd"), "a\\;b\\,c\\nd")


class TestBuildIcalVevent(unittest.TestCase):
    """fastmail.build_ical_vevent"""

    def setUp(self):
        self.start = datetime(2026, 3, 15, 14, 0, 0)
        self.end = datetime(2026, 3, 15, 15, 0, 0)

    def _build(self, **kwargs) -> str:
        defaults = dict(
            uid="test-uid@example.com",
            subject="Test Meeting",
            start=self.start,
            end=self.end,
            timezone_str="America/Los_Angeles",
        )
        defaults.update(kwargs)
        return fastmail.build_ical_vevent(**defaults)

    def test_required_properties_present(self):
        ical = self._build()
        self.assertIn("BEGIN:VCALENDAR", ical)
        self.assertIn("BEGIN:VEVENT", ical)
        self.assertIn("END:VEVENT", ical)
        self.assertIn("END:VCALENDAR", ical)
        self.assertIn("UID:test-uid@example.com", ical)
        self.assertIn("SUMMARY:Test Meeting", ical)
        self.assertIn("METHOD:REQUEST", ical)

    def test_location_included(self):
        ical = self._build(location="Conference Room A")
        self.assertIn("LOCATION:Conference Room A", ical)

    def test_no_location_when_absent(self):
        ical = self._build()
        self.assertNotIn("LOCATION:", ical)

    def test_attendees_included(self):
        ical = self._build(attendees=["alice@example.com", "bob@example.com"])
        self.assertIn("mailto:alice@example.com", ical)
        self.assertIn("mailto:bob@example.com", ical)

    def test_cancel_method(self):
        ical = self._build(method="CANCEL")
        self.assertIn("METHOD:CANCEL", ical)

    def test_sequence_number(self):
        ical = self._build(sequence=2)
        self.assertIn("SEQUENCE:2", ical)

    def test_crlf_line_endings(self):
        ical = self._build()
        self.assertIn("\r\n", ical)


# ── CalDAV client helpers ─────────────────────────────────────────────────────

class TestCalDAVClientInit(unittest.TestCase):
    """CalDAVClient initialisation and URL resolution."""

    def setUp(self):
        self.client = CalDAVClient(
            "https://caldav.example.com/",
            "user@example.com",
            "secret",
        )

    def test_base_url_normalized(self):
        self.assertTrue(self.client.base_url.endswith("/"))

    def test_auth_header_is_basic(self):
        self.assertTrue(self.client._auth.startswith("Basic "))

    def test_url_absolute_passthrough(self):
        url = self.client._url("https://other.example.com/path")
        self.assertEqual(url, "https://other.example.com/path")

    def test_url_relative_resolved(self):
        url = self.client._url("/dav/calendars/")
        self.assertEqual(url, "https://caldav.example.com/dav/calendars/")


class TestParseIcalEvent(unittest.TestCase):
    """caldav_client.parse_ical_event"""

    SAMPLE_ICAL = "\r\n".join([
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Test//EN",
        "BEGIN:VEVENT",
        "UID:abc123@example.com",
        "SUMMARY:Team Meeting",
        "DTSTART;TZID=America/Los_Angeles:20260315T140000",
        "DTEND;TZID=America/Los_Angeles:20260315T150000",
        "LOCATION:Zoom",
        "DESCRIPTION:Weekly sync",
        "ORGANIZER;CN=Alice:mailto:alice@example.com",
        "ATTENDEE;PARTSTAT=ACCEPTED;CN=Bob;RSVP=TRUE:mailto:bob@example.com",
        "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:carol@example.com",
        "SEQUENCE:1",
        "STATUS:CONFIRMED",
        "END:VEVENT",
        "END:VCALENDAR",
    ])

    def setUp(self):
        self.ev = parse_ical_event(self.SAMPLE_ICAL)

    def test_uid(self):
        self.assertEqual(self.ev["uid"], "abc123@example.com")

    def test_summary(self):
        self.assertEqual(self.ev["summary"], "Team Meeting")

    def test_dtstart(self):
        self.assertIn("20260315T140000", self.ev["dtstart"])

    def test_dtend(self):
        self.assertIn("20260315T150000", self.ev["dtend"])

    def test_location(self):
        self.assertEqual(self.ev["location"], "Zoom")

    def test_description(self):
        self.assertEqual(self.ev["description"], "Weekly sync")

    def test_organizer(self):
        self.assertEqual(self.ev["organizer"], "alice@example.com")

    def test_sequence(self):
        self.assertEqual(self.ev["sequence"], 1)

    def test_status(self):
        self.assertEqual(self.ev["status"], "confirmed")

    def test_attendees_count(self):
        self.assertEqual(len(self.ev["attendees"]), 2)

    def test_attendee_partstat_accepted(self):
        bob = next(a for a in self.ev["attendees"] if "bob" in a["email"])
        self.assertEqual(bob["partstat"], "ACCEPTED")
        self.assertTrue(bob["rsvp"])
        self.assertEqual(bob["name"], "Bob")

    def test_attendee_partstat_needs_action(self):
        carol = next(a for a in self.ev["attendees"] if "carol" in a["email"])
        self.assertEqual(carol["partstat"], "NEEDS-ACTION")

    def test_missing_properties_default_empty(self):
        minimal = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nEND:VEVENT\r\nEND:VCALENDAR"
        ev = parse_ical_event(minimal)
        self.assertEqual(ev["summary"], "")
        self.assertEqual(ev["location"], "")
        self.assertEqual(ev["description"], "")
        self.assertEqual(ev["attendees"], [])
        self.assertEqual(ev["sequence"], 0)

    def test_line_unfolding(self):
        folded = (
            "BEGIN:VCALENDAR\r\n"
            "BEGIN:VEVENT\r\n"
            "UID:folded-uid@example.com\r\n"
            "SUMMARY:Long summ\r\n"
            " ary here\r\n"
            "END:VEVENT\r\n"
            "END:VCALENDAR"
        )
        ev = parse_ical_event(folded)
        self.assertEqual(ev["summary"], "Long summary here")

    def test_text_unescaping(self):
        escaped = (
            "BEGIN:VCALENDAR\r\n"
            "BEGIN:VEVENT\r\n"
            "UID:esc@example.com\r\n"
            r"DESCRIPTION:a\,b\;c\nd" + "\r\n"
            "END:VEVENT\r\n"
            "END:VCALENDAR"
        )
        ev = parse_ical_event(escaped)
        self.assertEqual(ev["description"], "a,b;c\nd")


class TestUpdateIcalVevent(unittest.TestCase):
    """caldav_client.update_ical_vevent"""

    BASE = "\r\n".join([
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:orig@example.com",
        "SUMMARY:Original Title",
        "DTSTART:20260315T140000Z",
        "DTEND:20260315T150000Z",
        "SEQUENCE:0",
        "END:VEVENT",
        "END:VCALENDAR",
    ])

    def test_replace_summary(self):
        updated = update_ical_vevent(self.BASE, SUMMARY="New Title")
        ev = parse_ical_event(updated)
        self.assertEqual(ev["summary"], "New Title")

    def test_replace_sequence(self):
        updated = update_ical_vevent(self.BASE, SEQUENCE="1")
        ev = parse_ical_event(updated)
        self.assertEqual(ev["sequence"], 1)

    def test_add_new_property(self):
        updated = update_ical_vevent(self.BASE, LOCATION="Conference Room")
        ev = parse_ical_event(updated)
        self.assertEqual(ev["location"], "Conference Room")

    def test_remove_property(self):
        updated = update_ical_vevent(self.BASE, DTEND=None)
        self.assertNotIn("DTEND:", updated)

    def test_uid_preserved(self):
        updated = update_ical_vevent(self.BASE, SUMMARY="Changed")
        ev = parse_ical_event(updated)
        self.assertEqual(ev["uid"], "orig@example.com")

    def test_vcalendar_wrapper_preserved(self):
        updated = update_ical_vevent(self.BASE, SUMMARY="X")
        self.assertIn("BEGIN:VCALENDAR", updated)
        self.assertIn("VERSION:2.0", updated)
        self.assertIn("END:VCALENDAR", updated)

    def test_multiple_patches(self):
        updated = update_ical_vevent(self.BASE, SUMMARY="New", SEQUENCE="3")
        ev = parse_ical_event(updated)
        self.assertEqual(ev["summary"], "New")
        self.assertEqual(ev["sequence"], 3)

    def test_preserves_existing_property_params(self):
        ical = self.BASE.replace("DTSTART:20260315T140000Z", "DTSTART;TZID=America/Los_Angeles:20260315T140000")
        updated = update_ical_vevent(ical, DTSTART="20260316T090000")
        self.assertIn("DTSTART;TZID=America/Los_Angeles:20260316T090000", updated)

    def test_allows_explicit_property_params(self):
        updated = update_ical_vevent(
            self.BASE,
            DTSTART={"params": ";TZID=America/New_York", "value": "20260316T120000"},
        )
        self.assertIn("DTSTART;TZID=America/New_York:20260316T120000", updated)


class TestIcalUnescape(unittest.TestCase):
    """caldav_client._ical_unescape (tested indirectly via parse_ical_event)"""

    def _round_trip(self, text: str) -> str:
        escaped = fastmail.ical_escape(text)
        return caldav_client._ical_unescape(escaped)

    def test_newline_round_trip(self):
        self.assertEqual(self._round_trip("a\nb"), "a\nb")

    def test_comma_round_trip(self):
        self.assertEqual(self._round_trip("a,b"), "a,b")

    def test_semicolon_round_trip(self):
        self.assertEqual(self._round_trip("a;b"), "a;b")

    def test_backslash_round_trip(self):
        self.assertEqual(self._round_trip("a\\b"), "a\\b")

    def test_backslash_before_n_not_converted_to_newline(self):
        escaped = "a\\\\nb"
        self.assertEqual(caldav_client._ical_unescape(escaped), "a\\nb")


# ── RSVP state helpers ────────────────────────────────────────────────────────

class TestRsvpStateHelpers(unittest.TestCase):
    """fastmail load_rsvp_state / save_rsvp_state / rsvp_record_event"""

    def setUp(self):
        self._tmpdir = tempfile.mkdtemp()
        self._original = fastmail.RSVP_STATE_FILE
        fastmail.RSVP_STATE_FILE = os.path.join(self._tmpdir, "rsvp.json")

    def tearDown(self):
        fastmail.RSVP_STATE_FILE = self._original

    def test_load_returns_empty_when_missing(self):
        state = fastmail.load_rsvp_state()
        self.assertEqual(state, {})

    def test_save_and_load_round_trip(self):
        fastmail.save_rsvp_state({"uid1": {"title": "T1"}})
        state = fastmail.load_rsvp_state()
        self.assertEqual(state, {"uid1": {"title": "T1"}})

    def test_record_event_creates_entry(self):
        fastmail.rsvp_record_event(
            uid="abc@example.com",
            title="Sprint Review",
            start="2026-03-15T14:00",
            attendees=["alice@example.com", "bob@example.com"],
            backend="jmap",
        )
        state = fastmail.load_rsvp_state()
        self.assertIn("abc@example.com", state)
        rec = state["abc@example.com"]
        self.assertEqual(rec["title"], "Sprint Review")
        self.assertEqual(rec["backend"], "jmap")
        self.assertIn("alice@example.com", rec["attendees"])
        self.assertIn("bob@example.com", rec["attendees"])
        self.assertEqual(rec["attendees"]["alice@example.com"]["partstat"], "needs-action")

    def test_record_event_overwrites_existing(self):
        fastmail.rsvp_record_event("u1", "T1", "2026-01-01T09:00", ["a@x.com"], "jmap")
        fastmail.rsvp_record_event("u1", "T2", "2026-01-02T10:00", ["b@x.com"], "caldav")
        rec = fastmail.load_rsvp_state()["u1"]
        self.assertEqual(rec["title"], "T2")
        self.assertEqual(rec["backend"], "caldav")

    def test_update_from_ical_refreshes_partstat(self):
        fastmail.rsvp_record_event("u2", "T", "2026-01-01T09:00",
                                   ["alice@example.com"], "jmap")
        fastmail.rsvp_update_from_ical(
            "u2",
            [{"email": "alice@example.com", "name": "Alice", "partstat": "ACCEPTED"}],
        )
        rec = fastmail.load_rsvp_state()["u2"]
        self.assertEqual(rec["attendees"]["alice@example.com"]["partstat"], "ACCEPTED")

    def test_update_from_ical_ignores_unknown_uid(self):
        fastmail.rsvp_update_from_ical(
            "nonexistent-uid",
            [{"email": "x@x.com", "partstat": "ACCEPTED"}],
        )

    def test_load_returns_empty_on_corrupt_file(self):
        with open(fastmail.RSVP_STATE_FILE, "w") as f:
            f.write("{bad json")
        state = fastmail.load_rsvp_state()
        self.assertEqual(state, {})


# ── tools.py dispatch tests ──────────────────────────────────────────────────

class TestToolsManifest(unittest.TestCase):
    """tools.manifest() returns expected structure."""

    def test_manifest_has_all_tools(self):
        m = tools.manifest()
        names = {t["name"] for t in m["tools"]}
        expected = {
            "fastmail_send", "fastmail_search", "fastmail_read",
            "fastmail_inbox", "fastmail_meeting", "fastmail_update_event",
            "fastmail_query_events",
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
