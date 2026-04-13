#!/usr/bin/env python3
"""
Unit tests for package-tracking plugin.

Run: python3 -m pytest tests/test_tools.py -v
Or: python3 tests/test_tools.py
"""

import unittest
from unittest.mock import patch, MagicMock
import sys
import os
import json
import tempfile

# Add src directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from tools import (
    manifest,
    call,
    handle_package_track,
    handle_package_add,
    handle_package_remove,
    handle_package_list,
    handle_package_scan,
)
import tracking_client
from tracking_client import (
    detect_carrier,
    get_tracking_url,
    scan_text_for_tracking_numbers,
    is_shipping_sender,
    extract_tracking_from_urls,
    fetch_narvar_tracking,
)


class TestManifest(unittest.TestCase):
    """Test the manifest function returns proper tool definitions."""

    def test_manifest_has_tools(self):
        """Manifest should return a dict with 'tools' list."""
        m = manifest()
        self.assertIn("tools", m)
        self.assertIsInstance(m["tools"], list)

    def test_manifest_has_all_package_tools(self):
        """Manifest should include all package tracking tools."""
        m = manifest()
        tool_names = [t["name"] for t in m["tools"]]
        self.assertIn("package_track", tool_names)
        self.assertIn("package_add", tool_names)
        self.assertIn("package_remove", tool_names)
        self.assertIn("package_list", tool_names)
        self.assertIn("package_scan", tool_names)

    def test_manifest_tools_have_required_fields(self):
        """Each tool should have name, description, and input_schema."""
        m = manifest()
        for tool in m["tools"]:
            self.assertIn("name", tool)
            self.assertIn("description", tool)
            self.assertIn("input_schema", tool)
            self.assertIsInstance(tool["name"], str)
            self.assertIsInstance(tool["description"], str)
            self.assertIsInstance(tool["input_schema"], dict)

    def test_plugin_imports_use_shared_tracking_core(self):
        """Plugin entrypoints should depend on package_tracking_core, not local business logic."""
        self.assertEqual(detect_carrier.__module__, "package_tracking_core")
        self.assertEqual(handle_package_add.__globals__["add_package"].__module__, "package_tracking_core")


class TestCarrierDetection(unittest.TestCase):
    """Test carrier detection from tracking numbers."""

    def test_detect_ups_tracking_number(self):
        """Should detect UPS tracking numbers."""
        tracking = "1Z999AA10123456784"
        carrier = detect_carrier(tracking)
        self.assertEqual(carrier, "UPS")

    def test_detect_fedex_12_digit(self):
        """Should detect FedEx 12-digit tracking numbers."""
        tracking = "123456789012"
        carrier = detect_carrier(tracking)
        self.assertEqual(carrier, "FedEx")

    def test_detect_usps_tracking_number(self):
        """Should detect USPS tracking numbers."""
        tracking = "9400111899562537883057"
        carrier = detect_carrier(tracking)
        self.assertEqual(carrier, "USPS")

    def test_detect_amazon_tracking_number(self):
        """Should detect Amazon tracking numbers."""
        tracking = "TBA012345678901US"
        carrier = detect_carrier(tracking)
        self.assertEqual(carrier, "Amazon")

    def test_detect_unknown_returns_none(self):
        """Should return None for unknown tracking number formats."""
        tracking = "INVALID123"
        carrier = detect_carrier(tracking)
        self.assertIsNone(carrier)

    def test_carrier_detection_case_insensitive(self):
        """Should detect carriers regardless of case."""
        tracking = "tba012345678901us"
        carrier = detect_carrier(tracking)
        self.assertEqual(carrier, "Amazon")


class TestTrackingURLs(unittest.TestCase):
    """Test tracking URL generation."""

    def test_get_ups_tracking_url(self):
        """Should generate UPS tracking URL."""
        tracking = "1Z999AA10123456784"
        url = get_tracking_url(tracking)
        self.assertIsNotNone(url)
        self.assertIn("ups.com/track", url)
        self.assertIn(tracking, url)

    def test_get_fedex_tracking_url(self):
        """Should generate FedEx tracking URL."""
        tracking = "123456789012"
        url = get_tracking_url(tracking)
        self.assertIsNotNone(url)
        self.assertIn("fedex.com/fedextrack", url)
        self.assertIn(tracking, url)

    def test_get_usps_tracking_url(self):
        """Should generate USPS tracking URL."""
        tracking = "9400111899562537883057"
        url = get_tracking_url(tracking)
        self.assertIsNotNone(url)
        self.assertIn("usps.com", url)
        self.assertIn(tracking, url)

    def test_get_amazon_tracking_url(self):
        """Should generate Amazon tracking URL."""
        tracking = "TBA012345678901US"
        url = get_tracking_url(tracking)
        self.assertIsNotNone(url)
        self.assertIn("track.amazon.com", url)
        self.assertIn(tracking, url)

    def test_get_tracking_url_with_carrier_override(self):
        """Should use carrier override when provided."""
        tracking = "123456789012"
        url = get_tracking_url(tracking, carrier="FedEx")
        self.assertIsNotNone(url)
        self.assertIn("fedex.com", url)


class TestScanText(unittest.TestCase):
    """Test scanning text for tracking numbers."""

    def test_scan_empty_text(self):
        """Should return empty list for empty text."""
        results = scan_text_for_tracking_numbers("")
        self.assertEqual(len(results), 0)

    def test_scan_text_with_ups_tracking(self):
        """Should find UPS tracking numbers in text."""
        text = "Your package 1Z999AA10123456784 has shipped!"
        results = scan_text_for_tracking_numbers(text)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["carrier"], "UPS")
        self.assertEqual(results[0]["tracking_number"], "1Z999AA10123456784")
        self.assertIn("ups.com", results[0]["url"])

    def test_scan_text_with_multiple_tracking_numbers(self):
        """Should find multiple tracking numbers."""
        text = """
        Order 1: 1Z999AA10123456784 (UPS)
        Order 2: TBA012345678901US (Amazon)
        """
        results = scan_text_for_tracking_numbers(text)
        self.assertEqual(len(results), 2)
        carriers = {r["carrier"] for r in results}
        self.assertIn("UPS", carriers)
        self.assertIn("Amazon", carriers)

    def test_scan_text_no_duplicates(self):
        """Should not return duplicate tracking numbers."""
        text = "Tracking: 1Z999AA10123456784. Again: 1Z999AA10123456784"
        results = scan_text_for_tracking_numbers(text)
        self.assertEqual(len(results), 1)


class TestHandlePackageTrack(unittest.TestCase):
    """Test the handle_package_track handler."""

    def test_missing_tracking_number_returns_error(self):
        """Handler should return error when tracking_number is missing."""
        result = handle_package_track({})
        self.assertIn("error", result)
        self.assertIn("tracking_number", result["error"].lower())

    def test_empty_tracking_number_returns_error(self):
        """Handler should return error when tracking_number is empty."""
        result = handle_package_track({"tracking_number": ""})
        self.assertIn("error", result)

    def test_valid_ups_tracking_number(self):
        """Handler should return tracking info for valid UPS number."""
        result = handle_package_track({"tracking_number": "1Z999AA10123456784"})
        self.assertNotIn("error", result)
        self.assertEqual(result["carrier"], "UPS")
        self.assertIn("tracking_number", result)
        self.assertIn("url", result)
        self.assertIn("ups.com", result["url"])

    def test_unknown_tracking_number_returns_error(self):
        """Handler should return error for unknown tracking number format."""
        result = handle_package_track({"tracking_number": "INVALID123"})
        self.assertIn("error", result)

    def test_carrier_override(self):
        """Handler should use carrier override when provided."""
        result = handle_package_track({
            "tracking_number": "123456789012",
            "carrier": "FedEx"
        })
        self.assertNotIn("error", result)
        self.assertEqual(result["carrier"], "FedEx")


class TestHandlePackageScan(unittest.TestCase):
    """Test the handle_package_scan handler."""

    def test_missing_text_returns_error(self):
        """Handler should return error when text is missing."""
        result = handle_package_scan({})
        self.assertIn("error", result)

    def test_empty_text_returns_empty_list(self):
        """Handler should return empty list for empty text."""
        result = handle_package_scan({"text": ""})
        self.assertIn("error", result)

    def test_scan_text_with_tracking_numbers(self):
        """Handler should find tracking numbers in text."""
        text = "Your UPS package 1Z999AA10123456784 will arrive soon."
        result = handle_package_scan({"text": text})
        self.assertNotIn("error", result)
        self.assertIn("tracking_numbers", result)
        self.assertIn("count", result)
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["tracking_numbers"][0]["carrier"], "UPS")


class TestHandlePackageAdd(unittest.TestCase):
    """Test the handle_package_add handler."""

    def setUp(self):
        """Set up test with temporary storage."""
        self.temp_dir = tempfile.mkdtemp()
        self.storage_path = os.path.join(self.temp_dir, "package_tracking.json")
        # Patch the storage path
        self.patcher = patch("tracking_client.package_tracking_core._get_storage_path", return_value=self.storage_path)
        self.patcher.start()

    def tearDown(self):
        """Clean up temporary storage."""
        self.patcher.stop()
        if os.path.exists(self.storage_path):
            os.remove(self.storage_path)
        os.rmdir(self.temp_dir)

    def test_missing_tracking_number_returns_error(self):
        """Handler should return error when tracking_number is missing."""
        result = handle_package_add({})
        self.assertIn("error", result)

    def test_add_valid_package(self):
        """Handler should add package and return tracking info."""
        result = handle_package_add({
            "tracking_number": "1Z999AA10123456784",
            "label": "Test Package"
        })
        self.assertNotIn("error", result)
        self.assertEqual(result["carrier"], "UPS")
        self.assertEqual(result["label"], "Test Package")
        self.assertIn("added_at", result)


class TestHandlePackageList(unittest.TestCase):
    """Test the handle_package_list handler."""

    def setUp(self):
        """Set up test with temporary storage."""
        self.temp_dir = tempfile.mkdtemp()
        self.storage_path = os.path.join(self.temp_dir, "package_tracking.json")
        self.patcher = patch("tracking_client.package_tracking_core._get_storage_path", return_value=self.storage_path)
        self.patcher.start()

    def tearDown(self):
        """Clean up temporary storage."""
        self.patcher.stop()
        if os.path.exists(self.storage_path):
            os.remove(self.storage_path)
        os.rmdir(self.temp_dir)

    def test_list_empty_packages(self):
        """Handler should return empty list when no packages tracked."""
        result = handle_package_list({})
        self.assertNotIn("error", result)
        self.assertIn("packages", result)
        self.assertEqual(result["count"], 0)

    def test_list_packages_after_adding(self):
        """Handler should return added packages."""
        # Add a package first
        handle_package_add({"tracking_number": "1Z999AA10123456784"})
        # List packages
        result = handle_package_list({})
        self.assertNotIn("error", result)
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["packages"][0]["tracking_number"], "1Z999AA10123456784")


class TestHandlePackageRemove(unittest.TestCase):
    """Test the handle_package_remove handler."""

    def setUp(self):
        """Set up test with temporary storage."""
        self.temp_dir = tempfile.mkdtemp()
        self.storage_path = os.path.join(self.temp_dir, "package_tracking.json")
        self.patcher = patch("tracking_client.package_tracking_core._get_storage_path", return_value=self.storage_path)
        self.patcher.start()

    def tearDown(self):
        """Clean up temporary storage."""
        self.patcher.stop()
        if os.path.exists(self.storage_path):
            os.remove(self.storage_path)
        os.rmdir(self.temp_dir)

    def test_missing_tracking_number_returns_error(self):
        """Handler should return error when tracking_number is missing."""
        result = handle_package_remove({})
        self.assertIn("error", result)

    def test_remove_nonexistent_package_returns_error(self):
        """Handler should return error when package not found."""
        result = handle_package_remove({"tracking_number": "1Z999AA10123456784"})
        self.assertIn("error", result)
        self.assertIn("not found", result["error"].lower())

    def test_remove_existing_package(self):
        """Handler should remove package successfully."""
        # Add a package first
        handle_package_add({"tracking_number": "1Z999AA10123456784"})
        # Remove it
        result = handle_package_remove({"tracking_number": "1Z999AA10123456784"})
        self.assertNotIn("error", result)
        self.assertTrue(result["success"])
        # Verify it's gone
        list_result = handle_package_list({})
        self.assertEqual(list_result["count"], 0)


class TestCall(unittest.TestCase):
    """Test the call dispatcher."""

    def test_unknown_tool_returns_error(self):
        """Call should return error for unknown tool names."""
        result = call("unknown_tool", {})
        self.assertIn("error", result)
        self.assertIn("Unknown tool", result["error"])

    def test_calls_package_track_handler(self):
        """Call should dispatch to package_track handler."""
        result = call("package_track", {"tracking_number": "1Z999AA10123456784"})
        self.assertNotIn("error", result)
        self.assertEqual(result["carrier"], "UPS")

    def test_calls_package_list_handler(self):
        """Call should dispatch to package_list handler."""
        result = call("package_list", {})
        self.assertNotIn("error", result)
        self.assertIn("packages", result)


class TestShippingSenderAllowlist(unittest.TestCase):
    """Test the shipping sender allowlist (is_shipping_sender)."""

    def test_ups_domain(self):
        """Should allow any address @ups.com."""
        self.assertTrue(is_shipping_sender("tracking@ups.com"))

    def test_fedex_domain(self):
        """Should allow any address @fedex.com."""
        self.assertTrue(is_shipping_sender("noreply@fedex.com"))

    def test_usps_domain(self):
        """Should allow any address @usps.com."""
        self.assertTrue(is_shipping_sender("tracking@usps.com"))

    def test_amazon_domain(self):
        """Should allow any address @amazon.com."""
        self.assertTrue(is_shipping_sender("ship@amazon.com"))

    def test_narvar_domain(self):
        """Should allow any address @narvar.com."""
        self.assertTrue(is_shipping_sender("noreply@narvar.com"))

    def test_narvar_subdomain(self):
        """Should allow addresses @subdomain.narvar.com (e.g. Nespresso via Narvar)."""
        self.assertTrue(is_shipping_sender("noreply@nespresso.narvar.com"))

    def test_specific_nespresso_address(self):
        """Should allow the specific noreply@nespresso.com address."""
        self.assertTrue(is_shipping_sender("noreply@nespresso.com"))

    def test_aftership_domain(self):
        """Should allow any address @aftership.com."""
        self.assertTrue(is_shipping_sender("alerts@aftership.com"))

    def test_unknown_sender_rejected(self):
        """Should reject unknown senders."""
        self.assertFalse(is_shipping_sender("newsletter@random.com"))

    def test_generic_nespresso_address_rejected(self):
        """Other nespresso.com addresses are not in the allowlist."""
        self.assertFalse(is_shipping_sender("info@nespresso.com"))

    def test_empty_string_rejected(self):
        """Should return False for empty string."""
        self.assertFalse(is_shipping_sender(""))

    def test_none_rejected(self):
        """Should return False for None."""
        self.assertFalse(is_shipping_sender(None))

    def test_case_insensitive_domain(self):
        """Domain matching should be case-insensitive."""
        self.assertTrue(is_shipping_sender("Tracking@UPS.COM"))


class TestUrlTrackingExtraction(unittest.TestCase):
    """Test extract_tracking_from_urls()."""

    def test_narvar_url_with_tracking_param(self):
        """Should extract tracking number from a Narvar URL query parameter."""
        text = (
            "Track your package: "
            "https://nespresso.narvar.com/nespresso/tracking/ups"
            "?tracking_numbers=1Z999AA10123456784"
        )
        results = extract_tracking_from_urls(text)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["tracking_number"], "1Z999AA10123456784")
        self.assertEqual(results[0]["carrier"], "UPS")

    def test_narvar_url_carrier_from_path(self):
        """Should detect carrier from Narvar URL path segment."""
        text = (
            "https://example.narvar.com/brand/tracking/fedex"
            "?tracking_numbers=123456789012"
        )
        results = extract_tracking_from_urls(text)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["carrier"], "FedEx")

    def test_ups_tracking_url(self):
        """Should extract tracking number from a UPS tracking URL."""
        text = "https://www.ups.com/track?tracknum=1Z999AA10123456784"
        results = extract_tracking_from_urls(text)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["tracking_number"], "1Z999AA10123456784")
        self.assertEqual(results[0]["carrier"], "UPS")

    def test_fedex_tracking_url(self):
        """Should extract tracking number from a FedEx tracking URL."""
        text = "https://www.fedex.com/fedextrack/?trknbr=123456789012"
        results = extract_tracking_from_urls(text)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["tracking_number"], "123456789012")
        self.assertEqual(results[0]["carrier"], "FedEx")

    def test_usps_tracking_url(self):
        """Should extract tracking number from a USPS tracking URL."""
        text = (
            "https://tools.usps.com/go/TrackConfirmAction"
            "?qtc_tLabels1=94001118995625378830"
        )
        results = extract_tracking_from_urls(text)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["tracking_number"], "94001118995625378830")

    def test_no_urls_in_text(self):
        """Should return empty list when no shipping URLs present."""
        results = extract_tracking_from_urls("No URLs in this message.")
        self.assertEqual(len(results), 0)

    def test_empty_text(self):
        """Should return empty list for empty input."""
        results = extract_tracking_from_urls("")
        self.assertEqual(len(results), 0)

    def test_none_text(self):
        """Should return empty list for None input."""
        results = extract_tracking_from_urls(None)
        self.assertEqual(len(results), 0)

    def test_url_without_tracking_param_not_matched(self):
        """Should not match shipping URLs that lack a recognizable tracking param."""
        text = "https://www.ups.com/us/en/home.page"
        results = extract_tracking_from_urls(text)
        self.assertEqual(len(results), 0)

    def test_no_duplicates_from_same_url(self):
        """Same tracking number appearing twice in text should not be duplicated."""
        url = (
            "https://nespresso.narvar.com/tracking/ups"
            "?tracking_numbers=1Z999AA10123456784"
        )
        text = f"{url} and again {url}"
        results = extract_tracking_from_urls(text)
        self.assertEqual(len(results), 1)


class TestFetchNarvarTracking(unittest.TestCase):
    """Test fetch_narvar_tracking() — both the URL-param fast path and the HTTP fallback."""

    def test_fast_path_tracking_in_url(self):
        """Should return tracking info without an HTTP request when number is in URL."""
        url = (
            "https://nespresso.narvar.com/nespresso/tracking/ups"
            "?tracking_numbers=1Z999AA10123456784"
        )
        results = fetch_narvar_tracking(url)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["tracking_number"], "1Z999AA10123456784")
        self.assertEqual(results[0]["carrier"], "UPS")

    def test_http_fallback_parses_json_ld(self):
        """Should parse tracking number from JSON-LD on the Narvar page (HTTP fallback)."""
        url = "https://example.narvar.com/brand/tracking?order_id=ABC123"
        html_content = (
            '<html><head>'
            '<script type="application/ld+json">{"trackingNumber": "1Z999AA10123456784"}</script>'
            '</head></html>'
        )
        with patch("tracking_client.package_tracking_core.urlopen") as mock_urlopen:
            mock_resp = MagicMock()
            mock_resp.__enter__ = lambda s: s
            mock_resp.__exit__ = MagicMock(return_value=False)
            mock_resp.read.return_value = html_content.encode("utf-8")
            mock_urlopen.return_value = mock_resp

            results = fetch_narvar_tracking(url)
            self.assertEqual(len(results), 1)
            self.assertEqual(results[0]["tracking_number"], "1Z999AA10123456784")
            self.assertEqual(results[0]["carrier"], "UPS")

    def test_http_fallback_network_error_returns_empty(self):
        """Should return empty list when HTTP request fails."""
        from urllib.error import URLError
        url = "https://example.narvar.com/brand/tracking?order_id=X"
        with patch("tracking_client.package_tracking_core.urlopen", side_effect=URLError("network error")):
            results = fetch_narvar_tracking(url)
            self.assertEqual(len(results), 0)

    def test_http_fallback_page_without_tracking_returns_empty(self):
        """Should return empty list when page has no recognizable tracking number."""
        url = "https://example.narvar.com/brand/tracking?order_id=X"
        html_content = "<html><body>No tracking here</body></html>"
        with patch("tracking_client.package_tracking_core.urlopen") as mock_urlopen:
            mock_resp = MagicMock()
            mock_resp.__enter__ = lambda s: s
            mock_resp.__exit__ = MagicMock(return_value=False)
            mock_resp.read.return_value = html_content.encode("utf-8")
            mock_urlopen.return_value = mock_resp

            results = fetch_narvar_tracking(url)
            self.assertEqual(len(results), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
