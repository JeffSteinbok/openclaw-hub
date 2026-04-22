#!/usr/bin/env python3
"""Tests for package_tracking.py"""

import sys
import os
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from mail_runtime_core.runtime import MailEnvelope
from mail_runtime_core.package_tracking import (
    is_delivery_notification,
    scan_and_add_packages,
    scan_and_remove_delivered,
)


def _envelope(**overrides):
    defaults = dict(
        message_id="msg-1",
        provider="test-provider",
        account_id="acct-1",
        mailbox_id="inbox",
        sender_name="FedEx",
        sender_email="tracking@fedex.com",
        subject="Your package is on its way",
    )
    defaults.update(overrides)
    return MailEnvelope(**defaults)


def _mock_tracking_client(**overrides):
    client = MagicMock()
    client.is_shipping_sender.return_value = overrides.get("is_shipping", True)
    client.scan_text_for_tracking_numbers.return_value = overrides.get("scan_text", [])
    client.extract_tracking_from_urls.return_value = overrides.get("url_found", [])
    client.fetch_narvar_tracking.return_value = overrides.get("narvar", [])
    client.add_package.return_value = overrides.get("add_result", {"success": True})
    client.remove_package.return_value = overrides.get("remove_result", {"success": True})
    return client


# ---------------------------------------------------------------------------
# is_delivery_notification
# ---------------------------------------------------------------------------
class TestIsDeliveryNotification(unittest.TestCase):
    def test_positive_delivered(self):
        self.assertTrue(is_delivery_notification("Your package has been delivered"))

    def test_positive_delivery_complete(self):
        self.assertTrue(is_delivery_notification("Delivery complete for order #123"))

    def test_negative(self):
        self.assertFalse(is_delivery_notification("Your package is on its way"))

    def test_case_insensitive(self):
        self.assertTrue(is_delivery_notification("DELIVERED"))

    def test_empty_subject(self):
        self.assertFalse(is_delivery_notification(""))

    def test_none_subject(self):
        self.assertFalse(is_delivery_notification(None))


# ---------------------------------------------------------------------------
# scan_and_add_packages
# ---------------------------------------------------------------------------
class TestScanAndAddPackages(unittest.TestCase):
    def test_non_shipping_sender_skip(self):
        client = _mock_tracking_client(is_shipping=False)
        logger = MagicMock()
        result = scan_and_add_packages(
            _envelope(),
            account_label="Test",
            logger=logger,
            tracking_client_loader=lambda: client,
        )
        self.assertEqual(result, [])
        logger.assert_called_once()
        self.assertIn("non-shipping sender", logger.call_args[0][0])

    def test_amazon_sender_skip(self):
        client = _mock_tracking_client()
        logger = MagicMock()
        result = scan_and_add_packages(
            _envelope(sender_email="orders@amazon.com"),
            account_label="Test",
            logger=logger,
            tracking_client_loader=lambda: client,
        )
        self.assertEqual(result, [])
        self.assertIn("Amazon", logger.call_args[0][0])

    def test_amazon_subdomain_skip(self):
        client = _mock_tracking_client()
        logger = MagicMock()
        result = scan_and_add_packages(
            _envelope(sender_email="ship@notify.amazon.com"),
            account_label="Test",
            logger=logger,
            tracking_client_loader=lambda: client,
        )
        self.assertEqual(result, [])

    def test_found_tracking_added(self):
        client = _mock_tracking_client(
            scan_text=[{"tracking_number": "1Z999", "carrier": "UPS"}],
            add_result={"success": True},
        )
        logger = MagicMock()
        result = scan_and_add_packages(
            _envelope(body_text="Track 1Z999"),
            account_label="MyAcct",
            logger=logger,
            tracking_client_loader=lambda: client,
        )
        self.assertEqual(result, ["1Z999"])
        client.add_package.assert_called_once_with("1Z999", "UPS", unittest.mock.ANY)

    def test_no_tracking_found(self):
        client = _mock_tracking_client(scan_text=[], url_found=[])
        logger = MagicMock()
        result = scan_and_add_packages(
            _envelope(body_text="No numbers here"),
            account_label="Test",
            logger=logger,
            tracking_client_loader=lambda: client,
        )
        self.assertEqual(result, [])

    def test_add_error_logged(self):
        client = _mock_tracking_client(
            scan_text=[{"tracking_number": "1Z999", "carrier": "UPS"}],
            add_result={"error": "duplicate"},
        )
        logger = MagicMock()
        result = scan_and_add_packages(
            _envelope(body_text="1Z999"),
            account_label="Test",
            logger=logger,
            tracking_client_loader=lambda: client,
        )
        self.assertEqual(result, [])
        self.assertTrue(any("failed to add" in str(c) for c in logger.call_args_list))

    def test_narvar_url_extraction(self):
        narvar_url = "https://track.narvar.com/abc123"
        client = _mock_tracking_client(
            scan_text=[],
            url_found=[],
            narvar=[{"tracking_number": "NAR001", "carrier": "USPS"}],
            add_result={"success": True},
        )
        logger = MagicMock()
        result = scan_and_add_packages(
            _envelope(body_text=f"Track here: {narvar_url}"),
            account_label="Test",
            logger=logger,
            tracking_client_loader=lambda: client,
        )
        self.assertEqual(result, ["NAR001"])
        client.fetch_narvar_tracking.assert_called_once_with(narvar_url)

    def test_dedup_tracking_numbers(self):
        client = _mock_tracking_client(
            scan_text=[{"tracking_number": "DUP1", "carrier": "UPS"}],
            url_found=[{"tracking_number": "DUP1", "carrier": "UPS"}],
            add_result={"success": True},
        )
        logger = MagicMock()
        result = scan_and_add_packages(
            _envelope(body_text="DUP1"),
            account_label="Test",
            logger=logger,
            tracking_client_loader=lambda: client,
        )
        self.assertEqual(result, ["DUP1"])
        client.add_package.assert_called_once()

    def test_exception_returns_empty(self):
        client = MagicMock()
        client.is_shipping_sender.side_effect = RuntimeError("boom")
        logger = MagicMock()
        result = scan_and_add_packages(
            _envelope(),
            account_label="Test",
            logger=logger,
            tracking_client_loader=lambda: client,
        )
        self.assertEqual(result, [])
        self.assertTrue(any("error" in str(c) for c in logger.call_args_list))


# ---------------------------------------------------------------------------
# scan_and_remove_delivered
# ---------------------------------------------------------------------------
class TestScanAndRemoveDelivered(unittest.TestCase):
    def test_found_and_removed(self):
        client = _mock_tracking_client(
            scan_text=[{"tracking_number": "1Z999", "carrier": "UPS"}],
            remove_result={"success": True},
        )
        logger = MagicMock()
        result = scan_and_remove_delivered(
            _envelope(body_text="Delivered 1Z999"),
            logger=logger,
            tracking_client_loader=lambda: client,
        )
        self.assertEqual(result, ["1Z999"])
        client.remove_package.assert_called_once_with("1Z999")

    def test_not_found_ignored(self):
        client = _mock_tracking_client(
            scan_text=[{"tracking_number": "1Z999", "carrier": "UPS"}],
            remove_result={"error": "not_found"},
        )
        logger = MagicMock()
        result = scan_and_remove_delivered(
            _envelope(body_text="Delivered 1Z999"),
            logger=logger,
            tracking_client_loader=lambda: client,
        )
        self.assertEqual(result, [])
        self.assertTrue(any("untracked" in str(c) for c in logger.call_args_list))

    def test_no_tracking_numbers(self):
        client = _mock_tracking_client(scan_text=[])
        logger = MagicMock()
        result = scan_and_remove_delivered(
            _envelope(body_text="Delivered but no number"),
            logger=logger,
            tracking_client_loader=lambda: client,
        )
        self.assertEqual(result, [])

    def test_exception_returns_empty(self):
        client = MagicMock()
        client.scan_text_for_tracking_numbers.side_effect = RuntimeError("boom")
        logger = MagicMock()
        result = scan_and_remove_delivered(
            _envelope(body_text="Delivered 1Z999"),
            logger=logger,
            tracking_client_loader=lambda: client,
        )
        self.assertEqual(result, [])
        self.assertTrue(any("error" in str(c) for c in logger.call_args_list))

    def test_remove_failure_logged(self):
        client = _mock_tracking_client(
            scan_text=[{"tracking_number": "1Z999", "carrier": "UPS"}],
            remove_result={"error": "server_error"},
        )
        logger = MagicMock()
        result = scan_and_remove_delivered(
            _envelope(body_text="1Z999"),
            logger=logger,
            tracking_client_loader=lambda: client,
        )
        self.assertEqual(result, [])
        self.assertTrue(any("failed to remove" in str(c) for c in logger.call_args_list))

    def test_uses_subject_when_no_body(self):
        client = _mock_tracking_client(
            scan_text=[{"tracking_number": "1Z999", "carrier": "UPS"}],
            remove_result={"success": True},
        )
        logger = MagicMock()
        result = scan_and_remove_delivered(
            _envelope(subject="Delivered 1Z999", body_text=None),
            logger=logger,
            tracking_client_loader=lambda: client,
        )
        self.assertEqual(result, ["1Z999"])
        client.scan_text_for_tracking_numbers.assert_called_once_with("Delivered 1Z999")


if __name__ == "__main__":
    unittest.main()
