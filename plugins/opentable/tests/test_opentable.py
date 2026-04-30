"""Unit tests for the OpenTable client."""

import sys
import os
import unittest
from datetime import datetime, timedelta
from unittest.mock import Mock, patch

# Add src dir to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from opentable_client import get_restaurant_id, check_availability, get_availability_hash

# A restaurant that reliably exists on OpenTable
TEST_SLUG = "john-howie-steak-bellevue"
TEST_RESTAURANT_ID = 34339

# Use a date 7 days from now to have the best chance of availability
TEST_DATE = (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d")


class TestLookup(unittest.TestCase):
    """Test restaurant ID lookup from URL slug."""

    @staticmethod
    def _mock_restaurant_page():
        response = Mock()
        response.status_code = 200
        response.text = """
        <html>
          <script id="primary-window-vars" type="application/json">
            {"windowVariables":{"__OT_GA_DATA__":{"cd6":"34339","cd1":"John Howie Steak"}}}
          </script>
        </html>
        """
        return response

    @staticmethod
    def _mock_session(response):
        session = Mock()
        session._ensure_csrf.return_value = True
        session.session.get.return_value = response
        return session

    def test_lookup_known_restaurant(self):
        with patch("opentable_client._get_session", return_value=self._mock_session(self._mock_restaurant_page())):
            result = get_restaurant_id(TEST_SLUG)
        self.assertNotIn("error", result, f"Lookup failed: {result}")
        self.assertEqual(result["restaurant_id"], TEST_RESTAURANT_ID)
        self.assertIn("name", result)

    def test_lookup_returns_name(self):
        with patch("opentable_client._get_session", return_value=self._mock_session(self._mock_restaurant_page())):
            result = get_restaurant_id(TEST_SLUG)
        self.assertNotIn("error", result)
        name = result.get("name", "")
        # Name could be either the full restaurant name or the slug
        self.assertTrue(
            "John Howie" in name or "john-howie" in name,
            f"Expected restaurant name to contain 'John Howie' or 'john-howie', got: {name}",
        )

    def test_lookup_invalid_slug(self):
        response = Mock()
        response.status_code = 404
        response.text = ""
        with patch("opentable_client._get_session", return_value=self._mock_session(response)):
            result = get_restaurant_id("this-restaurant-does-not-exist-xyzzy-99999")
        # Should return an error (404 or extraction failure)
        self.assertTrue(
            "error" in result or result.get("restaurant_id") is None,
            "Expected error for invalid slug",
        )

    def test_lookup_falls_back_when_session_errors(self):
        with patch("opentable_client._get_session", side_effect=RuntimeError("blocked")), \
             patch("opentable_client.plain_requests.get", return_value=self._mock_restaurant_page()):
            result = get_restaurant_id(TEST_SLUG)
        self.assertEqual(result["restaurant_id"], TEST_RESTAURANT_ID)


class TestAvailability(unittest.TestCase):
    """Test availability checking via GraphQL."""

    @staticmethod
    def _mock_session():
        session = Mock()
        session._gql_request.return_value = {
            "data": {
                "availability": [
                    {
                        "availabilityDays": [
                            {
                                "slots": [
                                    {
                                        "isAvailable": True,
                                        "slotHash": "slot-1",
                                        "timeOffsetMinutes": 0,
                                        "type": "Standard",
                                        "attributes": ["indoor"],
                                    }
                                ]
                            }
                        ]
                    }
                ]
            }
        }
        return session

    def test_availability_returns_data(self):
        with patch("opentable_client.HAS_CURL_CFFI", True), \
             patch("opentable_client._get_session", return_value=self._mock_session()):
            result = check_availability(TEST_RESTAURANT_ID, TEST_DATE, party_size=2, time="19:00")
        self.assertNotIn("error", result, f"Availability check failed: {result}")
        # Should have a 'slots' key (even if empty for that date)
        self.assertIn("slots", result)
        self.assertIn("count", result)
        self.assertIsInstance(result["slots"], list)
        self.assertEqual(len(result["slots"]), result["count"])

    def test_availability_slots_have_required_fields(self):
        with patch("opentable_client.HAS_CURL_CFFI", True), \
             patch("opentable_client._get_session", return_value=self._mock_session()):
            result = check_availability(TEST_RESTAURANT_ID, TEST_DATE, party_size=2, time="19:00")
        if result.get("count", 0) > 0:
            slot = result["slots"][0]
            self.assertIn("time", slot)
            self.assertIn("booking_url", slot)
            self.assertIn("opentable.com", slot["booking_url"])

    def test_availability_different_party_sizes(self):
        with patch("opentable_client.HAS_CURL_CFFI", True), \
             patch("opentable_client._get_session", return_value=self._mock_session()):
            for size in [1, 4]:
                result = check_availability(TEST_RESTAURANT_ID, TEST_DATE, party_size=size)
                self.assertNotIn("error", result, f"Failed for party_size={size}: {result}")


class TestHashConfig(unittest.TestCase):
    """Test hash configuration and env var override."""

    def test_default_hash(self):
        # Without env var, should return the default
        os.environ.pop("OPENTABLE_AVAILABILITY_HASH", None)
        h = get_availability_hash()
        self.assertEqual(len(h), 64)
        self.assertTrue(all(c in "0123456789abcdef" for c in h))

    def test_env_var_override(self):
        fake_hash = "a" * 64
        os.environ["OPENTABLE_AVAILABILITY_HASH"] = fake_hash
        try:
            self.assertEqual(get_availability_hash(), fake_hash)
        finally:
            del os.environ["OPENTABLE_AVAILABILITY_HASH"]


# ---------------------------------------------------------------------------
# Heartbeat
# ---------------------------------------------------------------------------

from tools import opentable_heartbeat_check, _fail, _send_notification


class TestHeartbeatCheck(unittest.TestCase):
    """opentable_heartbeat_check: lookup + availability validation."""

    @staticmethod
    def _mock_lookup_session():
        """Session that returns a successful restaurant lookup."""
        session = Mock()
        session._ensure_csrf.return_value = True
        response = Mock()
        response.status_code = 200
        response.text = """
        <html>
          <script id="primary-window-vars" type="application/json">
            {"windowVariables":{"__OT_GA_DATA__":{"cd6":"34339","cd1":"John Howie Steak"}}}
          </script>
        </html>
        """
        session.session.get.return_value = response
        session._gql_request.return_value = {
            "data": {
                "availability": [
                    {
                        "availabilityDays": [
                            {
                                "slots": [
                                    {
                                        "isAvailable": True,
                                        "slotHash": "slot-1",
                                        "timeOffsetMinutes": 0,
                                        "type": "Standard",
                                        "attributes": ["indoor"],
                                    }
                                ]
                            }
                        ]
                    }
                ]
            }
        }
        return session

    def test_success_when_both_pass(self):
        with patch("opentable_client.HAS_CURL_CFFI", True), \
             patch("opentable_client._get_session", return_value=self._mock_lookup_session()):
            result = opentable_heartbeat_check({})
        self.assertEqual(result["status"], "ok")

    def test_failure_when_lookup_fails(self):
        session = Mock()
        session._ensure_csrf.return_value = True
        response = Mock()
        response.status_code = 403
        response.text = ""
        session.session.get.return_value = response
        with patch("opentable_client._get_session", return_value=session), \
             patch("tools._send_notification"):
            result = opentable_heartbeat_check({})
        self.assertEqual(result["status"], "error")

    def test_failure_when_availability_fails(self):
        session = self._mock_lookup_session()
        session._gql_request.return_value = {"error": "stale hash"}
        with patch("opentable_client.HAS_CURL_CFFI", True), \
             patch("opentable_client._get_session", return_value=session), \
             patch("tools._send_notification"):
            result = opentable_heartbeat_check({})
        self.assertEqual(result["status"], "error")
        self.assertIn("hash", result["message"].lower())

    def test_failure_sends_notification(self):
        session = Mock()
        session._ensure_csrf.return_value = True
        response = Mock()
        response.status_code = 500
        response.text = ""
        session.session.get.return_value = response
        with patch("opentable_client._get_session", return_value=session), \
             patch("tools._send_notification") as mock_notify:
            opentable_heartbeat_check({})
        mock_notify.assert_called_once()

    def test_success_does_not_send_notification(self):
        with patch("opentable_client.HAS_CURL_CFFI", True), \
             patch("opentable_client._get_session", return_value=self._mock_lookup_session()), \
             patch("tools._send_notification") as mock_notify:
            opentable_heartbeat_check({})
        mock_notify.assert_not_called()


class TestFail(unittest.TestCase):
    """_fail returns a structured error dict."""

    def test_returns_error_status(self):
        result = _fail("Something went wrong")
        self.assertEqual(result["status"], "error")

    def test_notify_false_does_not_call_send(self):
        with patch("tools._send_notification") as mock_notify:
            _fail("msg", notify=False)
        mock_notify.assert_not_called()

    def test_notify_true_calls_send(self):
        with patch("tools._send_notification") as mock_notify:
            _fail("msg", notify=True)
        mock_notify.assert_called_once()


class TestSendNotification(unittest.TestCase):
    """_send_notification delegates to subprocess.run."""

    def test_sends_via_subprocess(self):
        with patch("tools.subprocess.run") as mock_run:
            _send_notification("Test alert")
        mock_run.assert_called_once()

    def test_exception_does_not_propagate(self):
        with patch("tools.subprocess.run", side_effect=Exception("broken")):
            _send_notification("Test alert")


class TestManifest(unittest.TestCase):
    """manifest() includes all three tools."""

    def test_manifest_has_all_tools(self):
        import tools
        names = {t["name"] for t in tools.manifest()["tools"]}
        self.assertIn("opentable_lookup", names)
        self.assertIn("opentable_availability", names)
        self.assertIn("opentable_heartbeat_check", names)


if __name__ == "__main__":
    unittest.main(verbosity=2)
