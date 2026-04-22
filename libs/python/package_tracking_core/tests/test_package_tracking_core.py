#!/usr/bin/env python3
"""Comprehensive tests for package_tracking_core."""

import io
import json
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

# Add the grandparent directory so `import package_tracking_core` resolves to the package.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from package_tracking_core import (
    add_package,
    detect_carrier,
    extract_tracking_from_urls,
    fetch_narvar_tracking,
    get_package,
    get_tracking_url,
    is_shipping_sender,
    list_packages,
    remove_package,
    scan_text_for_tracking_numbers,
)


# ---------------------------------------------------------------------------
# detect_carrier
# ---------------------------------------------------------------------------
class TestDetectCarrier(unittest.TestCase):
    def test_ups(self):
        self.assertEqual(detect_carrier("1Z999AA10123456784"), "UPS")

    def test_ups_lowercase(self):
        self.assertEqual(detect_carrier("1z999aa10123456784"), "UPS")

    def test_ups_with_whitespace(self):
        self.assertEqual(detect_carrier("  1Z999AA10123456784  "), "UPS")

    def test_amazon(self):
        self.assertEqual(detect_carrier("TBA123456789012US"), "Amazon")

    def test_fedex_12_digit(self):
        self.assertEqual(detect_carrier("123456789012"), "FedEx")

    def test_fedex_15_digit(self):
        self.assertEqual(detect_carrier("123456789012345"), "FedEx")

    def test_fedex_20_digit(self):
        self.assertEqual(detect_carrier("12345678901234567890"), "FedEx")

    def test_usps_94_prefix(self):
        self.assertEqual(detect_carrier("9400111899223100001234"), "USPS")

    def test_usps_92_prefix(self):
        self.assertEqual(detect_carrier("9200111899223100001234"), "USPS")

    def test_unknown(self):
        self.assertIsNone(detect_carrier("NOTAVALIDNUMBER"))

    def test_empty_string(self):
        self.assertIsNone(detect_carrier(""))

    def test_short_number(self):
        self.assertIsNone(detect_carrier("12345"))


# ---------------------------------------------------------------------------
# get_tracking_url
# ---------------------------------------------------------------------------
class TestGetTrackingUrl(unittest.TestCase):
    def test_ups_url(self):
        url = get_tracking_url("1Z999AA10123456784")
        self.assertIn("ups.com", url)
        self.assertIn("1Z999AA10123456784", url)

    def test_fedex_url(self):
        url = get_tracking_url("123456789012", carrier="FedEx")
        self.assertIn("fedex.com", url)
        self.assertIn("123456789012", url)

    def test_usps_url(self):
        url = get_tracking_url("9400111899223100001234")
        self.assertIn("usps.com", url)

    def test_amazon_url(self):
        url = get_tracking_url("TBA123456789012US")
        self.assertIn("amazon.com", url)

    def test_unknown_carrier_returns_none(self):
        self.assertIsNone(get_tracking_url("NOTAVALIDNUMBER"))

    def test_auto_detect_carrier(self):
        url = get_tracking_url("1Z999AA10123456784")
        self.assertIsNotNone(url)

    def test_explicit_carrier_override(self):
        url = get_tracking_url("123456789012", carrier="FedEx")
        self.assertIn("fedex.com", url)


# ---------------------------------------------------------------------------
# scan_text_for_tracking_numbers
# ---------------------------------------------------------------------------
class TestScanTextForTrackingNumbers(unittest.TestCase):
    def test_empty_text(self):
        self.assertEqual(scan_text_for_tracking_numbers(""), [])

    def test_none_text(self):
        self.assertEqual(scan_text_for_tracking_numbers(None), [])

    def test_single_ups(self):
        results = scan_text_for_tracking_numbers("Your tracking number is 1Z999AA10123456784.")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["carrier"], "UPS")
        self.assertEqual(results[0]["tracking_number"], "1Z999AA10123456784")
        self.assertIn("ups.com", results[0]["url"])

    def test_multiple_carriers(self):
        text = "UPS: 1Z999AA10123456784, Amazon: TBA123456789012US"
        results = scan_text_for_tracking_numbers(text)
        carriers = {r["carrier"] for r in results}
        self.assertIn("UPS", carriers)
        self.assertIn("Amazon", carriers)

    def test_no_duplicates(self):
        text = "Track 1Z999AA10123456784 and again 1Z999AA10123456784"
        results = scan_text_for_tracking_numbers(text)
        tracking_numbers = [r["tracking_number"] for r in results]
        self.assertEqual(len(tracking_numbers), len(set(tracking_numbers)))

    def test_no_matches(self):
        self.assertEqual(scan_text_for_tracking_numbers("No tracking info here."), [])


# ---------------------------------------------------------------------------
# is_shipping_sender
# ---------------------------------------------------------------------------
class TestIsShippingSender(unittest.TestCase):
    def test_ups_domain(self):
        self.assertTrue(is_shipping_sender("noreply@ups.com"))

    def test_fedex_domain(self):
        self.assertTrue(is_shipping_sender("tracking@fedex.com"))

    def test_subdomain(self):
        self.assertTrue(is_shipping_sender("noreply@notify.narvar.com"))

    def test_exact_email_match(self):
        self.assertTrue(is_shipping_sender("noreply@nespresso.com"))

    def test_unknown_sender(self):
        self.assertFalse(is_shipping_sender("random@example.com"))

    def test_empty_string(self):
        self.assertFalse(is_shipping_sender(""))

    def test_none(self):
        self.assertFalse(is_shipping_sender(None))

    def test_case_insensitive(self):
        self.assertTrue(is_shipping_sender("Noreply@UPS.COM"))

    def test_exact_email_case_insensitive(self):
        self.assertTrue(is_shipping_sender("NOREPLY@NESPRESSO.COM"))

    def test_nespresso_wrong_user(self):
        # Only the exact email should match, not any @nespresso.com address.
        self.assertFalse(is_shipping_sender("other@nespresso.com"))


# ---------------------------------------------------------------------------
# extract_tracking_from_urls
# ---------------------------------------------------------------------------
class TestExtractTrackingFromUrls(unittest.TestCase):
    def test_ups_url(self):
        text = "https://www.ups.com/track?tracknum=1Z999AA10123456784"
        results = extract_tracking_from_urls(text)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["tracking_number"], "1Z999AA10123456784")
        self.assertEqual(results[0]["carrier"], "UPS")

    def test_fedex_url(self):
        text = "https://www.fedex.com/fedextrack/?trknbr=123456789012"
        results = extract_tracking_from_urls(text)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["tracking_number"], "123456789012")
        self.assertEqual(results[0]["carrier"], "FedEx")

    def test_usps_url(self):
        text = "https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=94001118992231000012"
        results = extract_tracking_from_urls(text)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["carrier"], "USPS")

    def test_narvar_carrier_from_path(self):
        text = "https://tracking.narvar.com/tracking/ups?tracking_numbers=1Z999AA10123456784"
        results = extract_tracking_from_urls(text)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["carrier"], "UPS")

    def test_no_urls(self):
        self.assertEqual(extract_tracking_from_urls("just plain text"), [])

    def test_empty_text(self):
        self.assertEqual(extract_tracking_from_urls(""), [])

    def test_none_text(self):
        self.assertEqual(extract_tracking_from_urls(None), [])


# ---------------------------------------------------------------------------
# Storage helpers (add/remove/list/get) — mock _get_storage_path
# ---------------------------------------------------------------------------
class TestPackageStorage(unittest.TestCase):
    """Test add_package, remove_package, list_packages, get_package with a temp file."""

    def setUp(self):
        self._storage_file = os.path.join(
            os.path.dirname(__file__), "_test_package_storage.json"
        )
        # Start with a clean slate
        if os.path.exists(self._storage_file):
            os.remove(self._storage_file)
        self._patcher = patch(
            "package_tracking_core._get_storage_path",
            return_value=self._storage_file,
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()
        if os.path.exists(self._storage_file):
            os.remove(self._storage_file)

    def test_add_and_list(self):
        result = add_package("1Z999AA10123456784", label="Test")
        self.assertNotIn("error", result)
        self.assertEqual(result["carrier"], "UPS")
        self.assertEqual(result["label"], "Test")

        pkg_list = list_packages()
        self.assertEqual(pkg_list["count"], 1)

    def test_add_auto_detect_carrier(self):
        result = add_package("1Z999AA10123456784")
        self.assertEqual(result["carrier"], "UPS")

    def test_add_empty_tracking_number(self):
        result = add_package("")
        self.assertIn("error", result)

    def test_add_unknown_carrier(self):
        result = add_package("INVALIDTRACKING")
        self.assertIn("error", result)

    def test_get_package(self):
        add_package("1Z999AA10123456784")
        result = get_package("1Z999AA10123456784")
        self.assertEqual(result["tracking_number"], "1Z999AA10123456784")

    def test_get_package_not_found(self):
        result = get_package("1Z999AA10123456784")
        self.assertIn("error", result)

    def test_get_package_empty(self):
        result = get_package("")
        self.assertIn("error", result)

    def test_remove_package(self):
        add_package("1Z999AA10123456784")
        result = remove_package("1Z999AA10123456784")
        self.assertTrue(result.get("success"))

        pkg_list = list_packages()
        self.assertEqual(pkg_list["count"], 0)

    def test_remove_package_not_found(self):
        result = remove_package("1Z999AA10123456784")
        self.assertIn("error", result)

    def test_remove_empty_tracking(self):
        result = remove_package("")
        self.assertIn("error", result)

    def test_list_empty(self):
        pkg_list = list_packages()
        self.assertEqual(pkg_list["count"], 0)
        self.assertEqual(pkg_list["packages"], [])

    def test_add_multiple(self):
        add_package("1Z999AA10123456784")
        add_package("TBA123456789012US")
        pkg_list = list_packages()
        self.assertEqual(pkg_list["count"], 2)


# ---------------------------------------------------------------------------
# fetch_narvar_tracking — mock urlopen
# ---------------------------------------------------------------------------
class TestFetchNarvarTracking(unittest.TestCase):
    def test_fast_path_tracking_in_url(self):
        url = "https://tracking.narvar.com/tracking/ups?tracking_numbers=1Z999AA10123456784"
        results = fetch_narvar_tracking(url)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["tracking_number"], "1Z999AA10123456784")

    @patch("package_tracking_core.urlopen")
    def test_http_fallback_json_ld(self, mock_urlopen):
        html = '<script type="application/ld+json">{"trackingNumber": "1Z999AA10123456784"}</script>'
        mock_resp = MagicMock()
        mock_resp.read.return_value = html.encode("utf-8")
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        url = "https://tracking.narvar.com/somepage"
        results = fetch_narvar_tracking(url)
        self.assertTrue(len(results) >= 1)
        self.assertEqual(results[0]["tracking_number"], "1Z999AA10123456784")

    @patch("package_tracking_core.urlopen")
    def test_network_error_returns_empty(self, mock_urlopen):
        from urllib.error import URLError

        mock_urlopen.side_effect = URLError("network down")
        url = "https://tracking.narvar.com/somepage"
        results = fetch_narvar_tracking(url)
        self.assertEqual(results, [])


if __name__ == "__main__":
    unittest.main()
