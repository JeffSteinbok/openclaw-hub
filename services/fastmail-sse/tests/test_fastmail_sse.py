#!/usr/bin/env python3
"""
Unit tests for fastmail-sse daemon.

Run: python3 -m pytest tests/test_fastmail_sse.py -v
Or: python3 tests/test_fastmail_sse.py
"""

import unittest
from unittest.mock import patch, MagicMock, mock_open
import sys
import os
import json
import tempfile
from pathlib import Path

# Add parent directory to path to import fastmail-sse module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from mail_runtime import ActionRegistry, ActionResult, MailEnvelope, execute_rules

# Import the module - note we need to import it without the .py extension
import importlib.util
spec = importlib.util.spec_from_file_location(
    "fastmail_sse",
    os.path.join(os.path.dirname(__file__), "..", "fastmail-sse.py")
)
fastmail_sse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fastmail_sse)


class TestConfigLoading(unittest.TestCase):
    """Test configuration file loading."""

    def test_load_runtime_config_valid_file(self):
        """Should load valid runtime configuration file."""
        config_data = {
            "accounts": {
                "test123": {
                    "label": "test@example.com"
                }
            },
            "mail_rules": [{"id": "notify-all", "accounts": ["test123"], "actions": [{"name": "notify_email"}]}],
        }
        with patch("builtins.open", mock_open(read_data=json.dumps(config_data))):
            with patch("os.path.exists", return_value=True):
                result = fastmail_sse.load_runtime_config()
                self.assertEqual(result["accounts"]["test123"]["label"], "test@example.com")
                self.assertEqual(result["mail_rules"][0]["id"], "notify-all")

    def test_load_runtime_config_missing_file(self):
        """Should exit when config file doesn't exist."""
        with patch("os.path.exists", return_value=False):
            with self.assertRaises(SystemExit):
                fastmail_sse.load_runtime_config()

    def test_load_runtime_config_invalid_json(self):
        """Should exit when config file contains invalid JSON."""
        with patch("builtins.open", mock_open(read_data="invalid json {")):
            with patch("os.path.exists", return_value=True):
                with self.assertRaises(SystemExit):
                    fastmail_sse.load_runtime_config()

    def test_load_runtime_config_no_accounts(self):
        """Should exit when config has no accounts."""
        config_data = {"accounts": {}}
        with patch("builtins.open", mock_open(read_data=json.dumps(config_data))):
            with patch("os.path.exists", return_value=True):
                with self.assertRaises(SystemExit):
                    fastmail_sse.load_runtime_config()

    def test_load_runtime_config_rejects_legacy_account_rules(self):
        """Should reject legacy accounts.*.rules entries."""
        config_data = {
            "accounts": {
                "acct1": {"label": "Account 1", "rules": ["notify_all"]},
            },
            "mail_rules": [],
        }
        with patch("builtins.open", mock_open(read_data=json.dumps(config_data))):
            with patch("os.path.exists", return_value=True):
                with self.assertRaises(SystemExit) as ctx:
                    fastmail_sse.load_runtime_config()
                self.assertIn("accounts.*.rules is no longer supported", str(ctx.exception))


class TestFormatMessage(unittest.TestCase):
    """Test message formatting."""

    def test_format_regular_email(self):
        """Should format regular email messages."""
        sender = "John Doe <john@example.com>"
        email = "john@example.com"
        subject = "Project Update"
        result = fastmail_sse.format_message(sender, email, subject)
        self.assertIsNotNone(result)
        self.assertIn("📧", result)
        self.assertIn("John Doe", result)
        self.assertIn("Project Update", result)

    def test_format_email_no_sender_name(self):
        """Should format email when sender has no name."""
        sender = "john@example.com"
        email = "john@example.com"
        subject = "Test"
        result = fastmail_sse.format_message(sender, email, subject)
        self.assertIsNotNone(result)
        self.assertIn("john@example.com", result)

    def test_format_calendar_accepted(self):
        """Should format accepted calendar responses."""
        sender = "Jane Smith <jane@example.com>"
        email = "jane@example.com"
        subject = "accepted: Team Standup"
        result = fastmail_sse.format_message(sender, email, subject)
        self.assertIsNotNone(result)
        self.assertIn("👤", result)
        self.assertIn("Jane Smith", result)
        self.assertIn("accepted", result)
        self.assertIn("👍", result)
        self.assertIn("Team Standup", result)

    def test_format_calendar_declined(self):
        """Should format declined calendar responses."""
        sender = "Bob Wilson <bob@example.com>"
        email = "bob@example.com"
        subject = "declined: All Hands Meeting"
        result = fastmail_sse.format_message(sender, email, subject)
        self.assertIsNotNone(result)
        self.assertIn("👎", result)
        self.assertIn("declined", result)

    def test_format_calendar_tentative(self):
        """Should format tentative calendar responses."""
        sender = "Alice Brown <alice@example.com>"
        email = "alice@example.com"
        subject = "tentative: Code Review"
        result = fastmail_sse.format_message(sender, email, subject)
        self.assertIsNotNone(result)
        self.assertIn("🤷", result)
        self.assertIn("tentative", result)

    def test_skip_unsubscribe_emails(self):
        """Should skip emails with 'unsubscribe' in subject."""
        sender = "Marketing <marketing@example.com>"
        email = "marketing@example.com"
        subject = "Newsletter - unsubscribe here"
        result = fastmail_sse.format_message(sender, email, subject)
        self.assertIsNone(result)

    def test_skip_noreply_in_subject(self):
        """Should skip emails with noreply in subject."""
        sender = "System <system@example.com>"
        email = "system@example.com"
        subject = "Message from noreply"
        result = fastmail_sse.format_message(sender, email, subject)
        self.assertIsNone(result)

    def test_skip_no_reply_emails(self):
        """Should skip emails with 'no-reply' in subject."""
        sender = "System <system@example.com>"
        email = "system@example.com"
        subject = "no-reply: System Notification"
        result = fastmail_sse.format_message(sender, email, subject)
        self.assertIsNone(result)

    def test_case_insensitive_filtering(self):
        """Should apply filters case-insensitively."""
        sender = "Sender <sender@example.com>"
        email = "sender@example.com"
        subject = "UNSUBSCRIBE NOW"
        result = fastmail_sse.format_message(sender, email, subject)
        self.assertIsNone(result)


class TestGetEmailBodyText(unittest.TestCase):
    """Test email body text extraction."""

    def test_extract_from_text_body(self):
        """Should extract text from textBody parts."""
        email = {
            "textBody": [{"partId": "1"}],
            "bodyValues": {
                "1": {"value": "Email body text"}
            }
        }
        result = fastmail_sse.get_email_body_text(email)
        self.assertEqual(result, "Email body text")

    def test_extract_from_first_text_part(self):
        """Should extract from first textBody part when multiple exist."""
        email = {
            "textBody": [{"partId": "1"}, {"partId": "2"}],
            "bodyValues": {
                "1": {"value": "First part"},
                "2": {"value": "Second part"}
            }
        }
        result = fastmail_sse.get_email_body_text(email)
        self.assertEqual(result, "First part")

    def test_fallback_to_any_body_value(self):
        """Should fallback to any bodyValue when textBody is empty."""
        email = {
            "textBody": [],
            "bodyValues": {
                "3": {"value": "Some body text"}
            }
        }
        result = fastmail_sse.get_email_body_text(email)
        self.assertEqual(result, "Some body text")

    def test_no_body_values(self):
        """Should return empty string when no bodyValues."""
        email = {"textBody": [], "bodyValues": {}}
        result = fastmail_sse.get_email_body_text(email)
        self.assertEqual(result, "")

    def test_missing_body_values_key(self):
        """Should return empty string when bodyValues key missing."""
        email = {"textBody": [{"partId": "1"}]}
        result = fastmail_sse.get_email_body_text(email)
        self.assertEqual(result, "")

    def test_part_id_not_in_body_values(self):
        """Should fallback when textBody partId not in bodyValues."""
        email = {
            "textBody": [{"partId": "99"}],
            "bodyValues": {
                "1": {"value": "Available body"}
            }
        }
        result = fastmail_sse.get_email_body_text(email)
        self.assertEqual(result, "Available body")


class TestScanAndAddPackages(unittest.TestCase):
    """Test package tracking detection and addition."""

    def test_load_tracking_client_uses_repo_plugin_path(self):
        result = fastmail_sse.load_tracking_client()
        self.assertEqual(result.__name__, "package_tracking_core")

    def test_no_body_text(self):
        """Should return empty list when email has no body."""
        email = {"subject": "Test", "from": [{"email": "test@example.com"}]}
        # Mock get_email_body_text as a function in the module
        with patch.object(fastmail_sse, "get_email_body_text", return_value=""):
            result = fastmail_sse.scan_and_add_packages(email, "test_acct")
            self.assertEqual(len(result), 0)

    def test_scan_finds_ups_tracking(self):
        """Should find and add UPS tracking numbers."""
        # Set up ACCOUNT_CONFIG
        fastmail_sse.ACCOUNT_CONFIG = {"test_acct": {"label": "Test Account"}}

        email = {
            "subject": "Package Shipped",
            "from": [{"name": "UPS", "email": "pkginfo@ups.com"}]
        }
        body_text = "Your package 1Z999AA10123456784 is on the way!"

        mock_tracking_client = MagicMock()
        mock_tracking_client.is_shipping_sender.return_value = True
        mock_tracking_client.scan_text_for_tracking_numbers.return_value = [
            {
                "tracking_number": "1Z999AA10123456784",
                "carrier": "UPS",
                "url": "https://www.ups.com/track?tracknum=1Z999AA10123456784"
            }
        ]
        mock_tracking_client.add_package.return_value = {
            "tracking_number": "1Z999AA10123456784",
            "carrier": "UPS"
        }

        with patch.object(fastmail_sse, "get_email_body_text", return_value=body_text):
            with patch.object(fastmail_sse, "get_email_body_html", return_value=""):
                with patch.object(fastmail_sse, "load_tracking_client", return_value=mock_tracking_client):
                    result = fastmail_sse.scan_and_add_packages(email, "test_acct")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0], "1Z999AA10123456784")

    def test_scan_handles_no_tracking_numbers(self):
        """Should return empty list when no tracking numbers found."""
        fastmail_sse.ACCOUNT_CONFIG = {"test_acct": {"label": "Test"}}

        email = {
            "subject": "Regular Email",
            "from": [{"email": "sender@example.com"}]
        }
        body_text = "This is a regular email with no tracking numbers."

        mock_tracking_client = MagicMock()
        mock_tracking_client.scan_text_for_tracking_numbers.return_value = []

        with patch.object(fastmail_sse, "get_email_body_text", return_value=body_text):
            with patch.object(fastmail_sse, "load_tracking_client", return_value=mock_tracking_client):
                result = fastmail_sse.scan_and_add_packages(email, "test_acct")
                self.assertEqual(len(result), 0)

    def test_scan_handles_add_package_error(self):
        """Should handle errors when adding packages."""
        fastmail_sse.ACCOUNT_CONFIG = {"test_acct": {"label": "Shopping"}}

        email = {
            "subject": "Package",
            "from": [{"email": "test@example.com"}]
        }
        body_text = "Tracking: 1Z999AA10123456784"

        mock_tracking_client = MagicMock()
        mock_tracking_client.scan_text_for_tracking_numbers.return_value = [
            {"tracking_number": "1Z999AA10123456784", "carrier": "UPS"}
        ]
        mock_tracking_client.add_package.return_value = {
            "error": "Failed to add package"
        }

        with patch.object(fastmail_sse, "get_email_body_text", return_value=body_text):
            with patch.object(fastmail_sse, "load_tracking_client", return_value=mock_tracking_client):
                result = fastmail_sse.scan_and_add_packages(email, "test_acct")
                self.assertEqual(len(result), 0)

    def test_scan_handles_exception(self):
        """Should handle exceptions gracefully."""
        email = {"subject": "Test", "from": [{"email": "test@example.com"}]}

        with patch.object(fastmail_sse, "get_email_body_text", return_value="Body text"):
            with patch.object(fastmail_sse, "load_tracking_client", side_effect=Exception("Test error")):
                result = fastmail_sse.scan_and_add_packages(email, "test_acct")
                self.assertEqual(len(result), 0)

    def test_non_shipping_sender_skipped(self):
        """Should skip scanning when the sender is not in the shipping allowlist."""
        fastmail_sse.ACCOUNT_CONFIG = {"test_acct": {"label": "Test"}}

        email = {
            "subject": "Newsletter",
            "from": [{"email": "news@random-store.com"}],
        }

        mock_tracking_client = MagicMock()
        mock_tracking_client.is_shipping_sender.return_value = False

        with patch.object(fastmail_sse, "get_email_body_text", return_value="Some text"):
            with patch.object(fastmail_sse, "load_tracking_client", return_value=mock_tracking_client):
                result = fastmail_sse.scan_and_add_packages(email, "test_acct")

        self.assertEqual(len(result), 0)
        mock_tracking_client.scan_text_for_tracking_numbers.assert_not_called()

    def test_shipping_sender_proceeds_to_scan(self):
        """Should proceed to scan when sender is in the shipping allowlist."""
        fastmail_sse.ACCOUNT_CONFIG = {"test_acct": {"label": "Personal"}}

        email = {
            "subject": "Your package has shipped",
            "from": [{"name": "UPS", "email": "pkginfo@ups.com"}],
        }
        body_text = "Your UPS tracking number is 1Z999AA10123456784"

        mock_tracking_client = MagicMock()
        mock_tracking_client.is_shipping_sender.return_value = True
        mock_tracking_client.scan_text_for_tracking_numbers.return_value = [
            {
                "tracking_number": "1Z999AA10123456784",
                "carrier": "UPS",
                "url": "https://www.ups.com/track?tracknum=1Z999AA10123456784",
            }
        ]
        mock_tracking_client.extract_tracking_from_urls.return_value = []
        mock_tracking_client.fetch_narvar_tracking.return_value = []
        mock_tracking_client.add_package.return_value = {
            "tracking_number": "1Z999AA10123456784",
            "carrier": "UPS",
        }

        with patch.object(fastmail_sse, "get_email_body_text", return_value=body_text):
            with patch.object(fastmail_sse, "get_email_body_html", return_value=""):
                with patch.object(fastmail_sse, "load_tracking_client", return_value=mock_tracking_client):
                    result = fastmail_sse.scan_and_add_packages(email, "test_acct")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0], "1Z999AA10123456784")
        mock_tracking_client.scan_text_for_tracking_numbers.assert_called_once()

    def test_url_extraction_finds_narvar_tracking(self):
        """Should add tracking numbers found via URL extraction."""
        fastmail_sse.ACCOUNT_CONFIG = {"test_acct": {"label": "Personal"}}

        email = {
            "subject": "Your Nespresso order has shipped",
            "from": [{"name": "Nespresso", "email": "noreply@nespresso.com"}],
        }
        body_text = (
            "Track your order: "
            "https://nespresso.narvar.com/nespresso/tracking/ups"
            "?tracking_numbers=1Z999AA10123456784"
        )

        mock_tracking_client = MagicMock()
        mock_tracking_client.is_shipping_sender.return_value = True
        mock_tracking_client.scan_text_for_tracking_numbers.return_value = []
        mock_tracking_client.extract_tracking_from_urls.return_value = [
            {
                "tracking_number": "1Z999AA10123456784",
                "carrier": "UPS",
                "url": "https://www.ups.com/track?tracknum=1Z999AA10123456784",
            }
        ]
        mock_tracking_client.add_package.return_value = {
            "tracking_number": "1Z999AA10123456784",
            "carrier": "UPS",
        }

        with patch.object(fastmail_sse, "get_email_body_text", return_value=body_text):
            with patch.object(fastmail_sse, "get_email_body_html", return_value=""):
                with patch.object(fastmail_sse, "load_tracking_client", return_value=mock_tracking_client):
                    result = fastmail_sse.scan_and_add_packages(email, "test_acct")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0], "1Z999AA10123456784")
        mock_tracking_client.extract_tracking_from_urls.assert_called_once()

    def test_no_duplicate_tracking_numbers_from_text_and_url(self):
        """Should not add the same tracking number found by both text scan and URL extraction."""
        fastmail_sse.ACCOUNT_CONFIG = {"test_acct": {"label": "Personal"}}

        email = {
            "subject": "Shipped",
            "from": [{"email": "pkginfo@ups.com"}],
        }
        body_text = "Tracking 1Z999AA10123456784 https://ups.com/track?tracknum=1Z999AA10123456784"

        mock_tracking_client = MagicMock()
        mock_tracking_client.is_shipping_sender.return_value = True
        # Same number returned by both methods
        mock_tracking_client.scan_text_for_tracking_numbers.return_value = [
            {"tracking_number": "1Z999AA10123456784", "carrier": "UPS", "url": ""}
        ]
        mock_tracking_client.extract_tracking_from_urls.return_value = [
            {"tracking_number": "1Z999AA10123456784", "carrier": "UPS", "url": ""}
        ]
        mock_tracking_client.add_package.return_value = {
            "tracking_number": "1Z999AA10123456784",
            "carrier": "UPS",
        }

        with patch.object(fastmail_sse, "get_email_body_text", return_value=body_text):
            with patch.object(fastmail_sse, "get_email_body_html", return_value=""):
                with patch.object(fastmail_sse, "load_tracking_client", return_value=mock_tracking_client):
                    result = fastmail_sse.scan_and_add_packages(email, "test_acct")

        # Only added once despite appearing in both scans
        self.assertEqual(len(result), 1)
        self.assertEqual(mock_tracking_client.add_package.call_count, 1)

    def test_amazon_sender_is_skipped(self):
        """Should skip Amazon senders because their numbers are not externally trackable."""
        fastmail_sse.ACCOUNT_CONFIG = {"test_acct": {"label": "Personal"}}

        email = {
            "subject": "Your Amazon order",
            "from": [{"email": "ship@amazon.com"}],
        }

        mock_tracking_client = MagicMock()
        mock_tracking_client.is_shipping_sender.return_value = True

        with patch.object(fastmail_sse, "get_email_body_text", return_value="Tracking 1Z999AA10123456784"):
            with patch.object(fastmail_sse, "load_tracking_client", return_value=mock_tracking_client):
                result = fastmail_sse.scan_and_add_packages(email, "test_acct")

        self.assertEqual(result, [])
        mock_tracking_client.scan_text_for_tracking_numbers.assert_not_called()


class TestPipelineRules(unittest.TestCase):
    """Test the provider-agnostic mail rule pipeline."""

    def test_build_pipeline_rules_returns_mail_rules_only(self):
        config = {
            "accounts": {
                "acct1": {
                    "label": "Personal",
                }
            },
            "mail_rules": [
                {
                    "id": "usps-informed-delivery",
                    "accounts": ["acct1"],
                    "match": {
                        "sender_domain": "usps.com",
                        "subject_contains": "Informed Delivery",
                    },
                    "actions": [{"name": "process_usps_digest"}],
                    "continue": True,
                }
            ],
        }

        rules = fastmail_sse.build_pipeline_rules(config)
        self.assertEqual(rules[0]["id"], "usps-informed-delivery")
        self.assertEqual(len(rules), 1)

    def test_execute_rules_prefetches_attachments_for_action(self):
        registry = ActionRegistry()
        captured = {}

        def handler(ctx, params):
            captured["download_dir"] = ctx.artifacts.get("download_dir")
            captured["files"] = ctx.artifacts.get("downloaded_files")
            return []

        registry.register(
            "needs-attachments",
            handler,
            attachment_request={
                "content_types": ["image/*"],
                "inline_only": True,
                "include_body_html": True,
            },
        )

        envelope = MailEnvelope(
            message_id="m1",
            provider="fastmail",
            account_id="acct1",
            mailbox_id="inbox",
            sender_name="USPS",
            sender_email="digest@informeddelivery.usps.com",
            subject="Your Daily Digest",
        )
        provider = MagicMock()
        provider.download_attachments.return_value = ["body.html", "scan-1.jpg"]
        logger = MagicMock()

        with tempfile.TemporaryDirectory() as tmpdir:
            matched, results = execute_rules(
                envelope,
                [{
                    "id": "usps",
                    "accounts": ["acct1"],
                    "match": {"sender_domain": "usps.com"},
                    "actions": [{"name": "needs-attachments"}],
                }],
                registry,
                provider,
                workspace=Path(tmpdir),
                logger=logger,
                config={},
            )

        self.assertEqual(len(matched), 1)
        self.assertEqual(results, [])
        provider.download_attachments.assert_called_once()
        self.assertEqual(captured["files"], ["body.html", "scan-1.jpg"])
        self.assertIsNotNone(captured["download_dir"])
        log_messages = [call.args[0] for call in logger.call_args_list]
        self.assertTrue(any("matched mail rule(s): usps" in msg for msg in log_messages))
        self.assertTrue(any("running mail action needs-attachments for rule usps" in msg for msg in log_messages))
        self.assertTrue(any("downloaded 2 artifact(s) for action needs-attachments" in msg for msg in log_messages))

    def test_process_usps_digest_accepts_non_inline_attachments(self):
        fastmail_sse.ACTION_REGISTRY = ActionRegistry()
        fastmail_sse.register_actions()

        action = fastmail_sse.ACTION_REGISTRY.get("process_usps_digest")
        self.assertEqual(action.handler.__module__, "mail_action_usps.register")
        self.assertEqual(action.attachment_request["content_types"], ["image/*"])
        self.assertNotIn("inline_only", action.attachment_request)
        self.assertTrue(action.attachment_request["include_body_html"])

    def test_mail_runtime_wrapper_reexports_core_types(self):
        self.assertEqual(ActionRegistry.__module__, "mail_runtime_core.runtime")
        self.assertEqual(MailEnvelope.__module__, "mail_runtime_core.runtime")


class TestResultDispatch(unittest.TestCase):
    """Test ActionResult dispatch through the Fastmail adapter."""

    def test_dispatch_results_routes_known_kinds(self):
        results = [
            ActionResult(kind="message", payload={"message": "hello"}),
            ActionResult(
                kind="agent_handoff",
                payload={"agent": "mail", "message": "digest payload"},
            ),
            ActionResult(kind="log", payload={"message": "note"}),
        ]

        with patch.object(fastmail_sse, "deliver") as deliver:
            with patch.object(fastmail_sse, "handoff_to_agent") as handoff:
                with patch.object(fastmail_sse, "log") as logger:
                    fastmail_sse.dispatch_results(results)

        deliver.assert_called_once_with("hello")
        handoff.assert_called_once_with("mail", "digest payload")
        logger.assert_called_once_with("note")

    def test_dispatch_results_logs_unknown_kinds(self):
        with patch.object(fastmail_sse, "log") as logger:
            fastmail_sse.dispatch_results(
                [ActionResult(kind="unknown", payload={"message": "ignored"})]
            )

        logger.assert_called_once_with("warn: unknown action result kind unknown")


class TestGetEmailBodyHtml(unittest.TestCase):
    """Test HTML body extraction."""

    def test_extract_from_html_body(self):
        """Should extract HTML from htmlBody parts."""
        email = {
            "htmlBody": [{"partId": "2"}],
            "bodyValues": {
                "2": {"value": "<html><body>Hello</body></html>"}
            }
        }
        result = fastmail_sse.get_email_body_html(email)
        self.assertEqual(result, "<html><body>Hello</body></html>")

    def test_no_html_body(self):
        """Should return empty string when htmlBody is absent."""
        email = {"htmlBody": [], "bodyValues": {}}
        result = fastmail_sse.get_email_body_html(email)
        self.assertEqual(result, "")

    def test_missing_html_body_key(self):
        """Should return empty string when htmlBody key is missing."""
        email = {}
        result = fastmail_sse.get_email_body_html(email)
        self.assertEqual(result, "")

    def test_html_body_part_id_not_in_body_values(self):
        """Should return empty string when partId is not found in bodyValues."""
        email = {
            "htmlBody": [{"partId": "99"}],
            "bodyValues": {"1": {"value": "other part"}}
        }
        result = fastmail_sse.get_email_body_html(email)
        self.assertEqual(result, "")


class TestStateManagement(unittest.TestCase):
    """Test state persistence functions."""

    def test_load_state_existing_file(self):
        """Should load state from existing file."""
        state_data = {"EmailStates": {"acct1": "state123"}}
        with patch("os.path.exists", return_value=True):
            with patch("builtins.open", mock_open(read_data=json.dumps(state_data))):
                result = fastmail_sse.load_state()
                self.assertEqual(result, state_data)

    def test_load_state_missing_file(self):
        """Should return empty dict when file doesn't exist."""
        with patch("os.path.exists", return_value=False):
            result = fastmail_sse.load_state()
            self.assertEqual(result, {})

    def test_load_state_corrupt_file(self):
        """Should return empty dict when file is corrupt."""
        with patch("os.path.exists", return_value=True):
            with patch("builtins.open", mock_open(read_data="invalid json {")):
                result = fastmail_sse.load_state()
                self.assertEqual(result, {})

    def test_save_state(self):
        """Should save state to file atomically."""
        state_data = {"EmailStates": {"acct1": "state456"}}

        mock_file = mock_open()
        with patch("builtins.open", mock_file):
            with patch("os.makedirs"):
                with patch("os.replace") as mock_replace:
                    fastmail_sse.save_state(state_data)

                    # Verify file was written
                    mock_file.assert_called()
                    # Verify atomic replace was used
                    mock_replace.assert_called_once()


if __name__ == "__main__":
    unittest.main(verbosity=2)
