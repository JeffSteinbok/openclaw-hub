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


if __name__ == "__main__":
    unittest.main(verbosity=2)
