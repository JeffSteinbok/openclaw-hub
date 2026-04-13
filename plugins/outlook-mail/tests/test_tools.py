"""Unit tests for the outlook-mail plugin (no network access required).

Covers:
  - format_message: unread indicator, sender formatting, subject, body preview
  - handle_inbox: mocked get_access_token + graph_get
  - handle_search: filter combinations, mocked calls, HTTP error handling
  - handle_read: mocked call, response shaping
  - manifest: structure validation
"""

import os
import sys
import unittest
import urllib.error
from unittest.mock import MagicMock, patch

_SRC_DIR = os.path.join(os.path.dirname(__file__), "..", "src")
sys.path.insert(0, _SRC_DIR)

# Provide dummy env vars so the module can be imported without crashing
os.environ.setdefault("OUTLOOK_CLIENT_ID", "test-id")
os.environ.setdefault("OUTLOOK_CLIENT_SECRET", "test-secret")
os.environ.setdefault("OUTLOOK_REFRESH_TOKEN", "test-refresh")

from outlook_mail import format_message
import tools


# ---------------------------------------------------------------------------
# format_message
# ---------------------------------------------------------------------------

def _msg(read=True, name="Alice", address="alice@example.com", subject="Hello", body=None):
    m = {
        "isRead": read,
        "receivedDateTime": "2026-03-15T10:30:00Z",
        "from": {"emailAddress": {"name": name, "address": address}},
        "subject": subject,
    }
    if body is not None:
        m["body"] = {"content": body}
    return m


class TestFormatMessage(unittest.TestCase):
    """format_message produces a human-readable string for a message."""

    def test_unread_has_indicator(self):
        result = format_message(_msg(read=False))
        self.assertIn("🔵", result)

    def test_read_no_indicator(self):
        result = format_message(_msg(read=True))
        self.assertNotIn("🔵", result)

    def test_contains_sender_name(self):
        result = format_message(_msg(name="Bob"))
        self.assertIn("Bob", result)

    def test_contains_sender_address(self):
        result = format_message(_msg(address="bob@example.com"))
        self.assertIn("bob@example.com", result)

    def test_contains_subject(self):
        result = format_message(_msg(subject="My Subject"))
        self.assertIn("My Subject", result)

    def test_date_truncated_to_date_part(self):
        result = format_message(_msg())
        self.assertIn("2026-03-15", result)

    def test_no_body_by_default(self):
        result = format_message(_msg(body="Secret content"))
        self.assertNotIn("Secret content", result)

    def test_body_included_when_requested(self):
        result = format_message(_msg(body="Preview text here"), body=True)
        self.assertIn("Preview text here", result)


# ---------------------------------------------------------------------------
# handle_inbox
# ---------------------------------------------------------------------------

FAKE_MESSAGES = [
    {
        "id": "msg1",
        "subject": "Meeting Tomorrow",
        "from": {"emailAddress": {"name": "Bob", "address": "bob@work.com"}},
        "receivedDateTime": "2026-03-14T09:00:00Z",
        "isRead": False,
    },
    {
        "id": "msg2",
        "subject": "Project Update",
        "from": {"emailAddress": {"name": "Carol", "address": "carol@work.com"}},
        "receivedDateTime": "2026-03-13T15:00:00Z",
        "isRead": True,
    },
]


class TestHandleInbox(unittest.TestCase):
    """handle_inbox with mocked token + Graph API."""

    @patch("tools.graph_get", return_value={"value": FAKE_MESSAGES})
    @patch("tools.get_access_token", return_value="fake-token")
    def test_returns_count_and_messages(self, _tok, _graph):
        result = tools.handle_inbox({})
        self.assertEqual(result["count"], 2)
        self.assertEqual(len(result["messages"]), 2)

    @patch("tools.graph_get", return_value={"value": FAKE_MESSAGES})
    @patch("tools.get_access_token", return_value="fake-token")
    def test_message_has_expected_fields(self, _tok, _graph):
        result = tools.handle_inbox({})
        msg = result["messages"][0]
        self.assertIn("id", msg)
        self.assertIn("subject", msg)
        self.assertIn("from", msg)
        self.assertIn("receivedDateTime", msg)
        self.assertIn("isRead", msg)

    @patch("tools.graph_get", return_value={"value": []})
    @patch("tools.get_access_token", return_value="fake-token")
    def test_empty_inbox(self, _tok, _graph):
        result = tools.handle_inbox({})
        self.assertEqual(result["count"], 0)
        self.assertEqual(result["messages"], [])

    @patch("tools.graph_get", return_value={"value": FAKE_MESSAGES})
    @patch("tools.get_access_token", return_value="fake-token")
    def test_unread_filter_modifies_path(self, _tok, mock_graph):
        tools.handle_inbox({"unread": True})
        path = mock_graph.call_args[0][1]
        self.assertIn("false", path)


# ---------------------------------------------------------------------------
# handle_search
# ---------------------------------------------------------------------------

class TestHandleSearch(unittest.TestCase):
    """handle_search builds OData filters and maps response fields."""

    @patch("tools.graph_get", return_value={"value": FAKE_MESSAGES})
    @patch("tools.get_access_token", return_value="fake-token")
    def test_returns_results(self, _tok, _graph):
        result = tools.handle_search({"query": "meeting"})
        self.assertEqual(result["count"], 2)

    @patch("tools.graph_get", return_value={"value": FAKE_MESSAGES})
    @patch("tools.get_access_token", return_value="fake-token")
    def test_no_filter_still_works(self, _tok, _graph):
        result = tools.handle_search({})
        self.assertNotIn("error", result)

    @patch("tools.graph_get", return_value={"value": FAKE_MESSAGES})
    @patch("tools.get_access_token", return_value="fake-token")
    def test_sender_filter_applied(self, _tok, mock_graph):
        tools.handle_search({"from": "bob@work.com"})
        path = mock_graph.call_args[0][1]
        self.assertIn("bob%40work.com", path)

    @patch("tools.graph_get", return_value={"value": FAKE_MESSAGES})
    @patch("tools.get_access_token", return_value="fake-token")
    def test_date_range_filters_applied(self, _tok, mock_graph):
        tools.handle_search({"since": "2026-03-01", "before": "2026-03-31"})
        path = mock_graph.call_args[0][1]
        self.assertIn("2026-03-01", path)
        self.assertIn("2026-03-31", path)

    @patch("tools.get_access_token", return_value="fake-token")
    def test_http_error_returns_error_dict(self, _tok):
        err = urllib.error.HTTPError(url="u", code=400, msg="Bad Request", hdrs=None, fp=None)
        err.read = lambda: b"OData error detail"
        with patch("tools.graph_get", side_effect=err):
            result = tools.handle_search({"query": "test"})
        self.assertIn("error", result)
        self.assertIn("400", result["error"])


# ---------------------------------------------------------------------------
# handle_read
# ---------------------------------------------------------------------------

FAKE_MESSAGE_FULL = {
    "id": "msg1",
    "subject": "Full Message",
    "from": {"emailAddress": {"name": "Dave", "address": "dave@example.com"}},
    "toRecipients": [{"emailAddress": {"name": "Me", "address": "me@example.com"}}],
    "receivedDateTime": "2026-03-14T09:00:00Z",
    "isRead": True,
    "body": {"content": "<p>Hello</p>"},
}


class TestHandleRead(unittest.TestCase):
    """handle_read fetches and shapes a single message."""

    @patch("tools.graph_get", return_value=FAKE_MESSAGE_FULL)
    @patch("tools.get_access_token", return_value="fake-token")
    def test_returns_expected_fields(self, _tok, _graph):
        result = tools.handle_read({"message_id": "msg1"})
        self.assertEqual(result["id"], "msg1")
        self.assertEqual(result["subject"], "Full Message")
        self.assertIn("from", result)
        self.assertIn("to", result)
        self.assertIn("body", result)
        self.assertIn("receivedDateTime", result)
        self.assertIn("isRead", result)

    @patch("tools.graph_get", return_value=FAKE_MESSAGE_FULL)
    @patch("tools.get_access_token", return_value="fake-token")
    def test_to_list_is_list(self, _tok, _graph):
        result = tools.handle_read({"message_id": "msg1"})
        self.assertIsInstance(result["to"], list)

    @patch("tools.graph_get", return_value=FAKE_MESSAGE_FULL)
    @patch("tools.get_access_token", return_value="fake-token")
    def test_body_content_returned(self, _tok, _graph):
        result = tools.handle_read({"message_id": "msg1"})
        self.assertEqual(result["body"], "<p>Hello</p>")

    @patch("tools.graph_get", return_value=FAKE_MESSAGE_FULL)
    @patch("tools.get_access_token", return_value="fake-token")
    def test_correct_path_used(self, _tok, mock_graph):
        tools.handle_read({"message_id": "abc123"})
        path = mock_graph.call_args[0][1]
        self.assertIn("abc123", path)


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
        self.assertIn("outlook_inbox", names)
        self.assertIn("outlook_search", names)
        self.assertIn("outlook_read", names)

    def test_each_tool_has_required_fields(self):
        for tool in tools.manifest()["tools"]:
            self.assertIn("name", tool)
            self.assertIn("description", tool)
            self.assertIn("input_schema", tool)


if __name__ == "__main__":
    unittest.main(verbosity=2)
