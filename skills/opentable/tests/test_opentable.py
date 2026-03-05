"""Integration tests for the OpenTable client.

These tests hit the live OpenTable API — they require network access and
may be flaky if OpenTable changes their site or the persisted query hash
expires.

Known test restaurant: John Howie Steak - Bellevue
  Slug: john-howie-steak-bellevue
  ID:   34339
"""

import sys
import os
import unittest
from datetime import datetime, timedelta

# Add scripts dir to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
from opentable_client import get_restaurant_id, check_availability, get_availability_hash

# A restaurant that reliably exists on OpenTable
TEST_SLUG = "john-howie-steak-bellevue"
TEST_RESTAURANT_ID = 34339

# Use a date 7 days from now to have the best chance of availability
TEST_DATE = (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d")


class TestLookup(unittest.TestCase):
    """Test restaurant ID lookup from URL slug."""

    def test_lookup_known_restaurant(self):
        result = get_restaurant_id(TEST_SLUG)
        self.assertNotIn("error", result, f"Lookup failed: {result}")
        self.assertEqual(result["restaurant_id"], TEST_RESTAURANT_ID)
        self.assertIn("name", result)

    def test_lookup_returns_name(self):
        result = get_restaurant_id(TEST_SLUG)
        self.assertNotIn("error", result)
        name = result.get("name", "")
        # Name could be either the full restaurant name or the slug
        self.assertTrue(
            "John Howie" in name or "john-howie" in name,
            f"Expected restaurant name to contain 'John Howie' or 'john-howie', got: {name}",
        )

    def test_lookup_invalid_slug(self):
        result = get_restaurant_id("this-restaurant-does-not-exist-xyzzy-99999")
        # Should return an error (404 or extraction failure)
        self.assertTrue(
            "error" in result or result.get("restaurant_id") is None,
            "Expected error for invalid slug",
        )


class TestAvailability(unittest.TestCase):
    """Test availability checking via GraphQL."""

    def test_availability_returns_data(self):
        result = check_availability(TEST_RESTAURANT_ID, TEST_DATE, party_size=2, time="19:00")
        self.assertNotIn("error", result, f"Availability check failed: {result}")
        # Should have a 'slots' key (even if empty for that date)
        self.assertIn("slots", result)
        self.assertIn("count", result)
        self.assertIsInstance(result["slots"], list)
        self.assertEqual(len(result["slots"]), result["count"])

    def test_availability_slots_have_required_fields(self):
        result = check_availability(TEST_RESTAURANT_ID, TEST_DATE, party_size=2, time="19:00")
        if result.get("count", 0) > 0:
            slot = result["slots"][0]
            self.assertIn("time", slot)
            self.assertIn("booking_url", slot)
            self.assertIn("opentable.com", slot["booking_url"])

    def test_availability_different_party_sizes(self):
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
