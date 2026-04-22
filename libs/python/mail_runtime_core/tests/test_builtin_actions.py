#!/usr/bin/env python3
"""Tests for builtin_actions.py"""

import sys
import os
import unittest
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from mail_runtime_core.runtime import ActionContext, ActionResult, MailEnvelope
from mail_runtime_core.builtin_actions import (
    build_detect_tracking_action,
    build_notify_email_action,
    format_message,
)


def _envelope(**overrides):
    defaults = dict(
        message_id="msg-1",
        provider="test-provider",
        account_id="acct-1",
        mailbox_id="inbox",
        sender_name="Alice Smith",
        sender_email="alice@example.com",
        subject="Hello World",
    )
    defaults.update(overrides)
    return MailEnvelope(**defaults)


def _action_context(envelope=None, **overrides):
    env = envelope or _envelope()
    defaults = dict(
        envelope=env,
        provider_client=MagicMock(),
        workspace=MagicMock(),
        logger=MagicMock(),
        config={},
        artifacts={},
    )
    defaults.update(overrides)
    return ActionContext(**defaults)


# ---------------------------------------------------------------------------
# format_message
# ---------------------------------------------------------------------------
class TestFormatMessage(unittest.TestCase):
    def test_regular_email(self):
        result = format_message("Alice <alice@ex.com>", "alice@ex.com", "Hello")
        self.assertEqual(result, "📧 Alice: Hello")

    def test_no_sender_name(self):
        result = format_message("", "alice@ex.com", "Hello")
        self.assertEqual(result, "📧 alice@ex.com: Hello")

    def test_sender_email_only_in_str(self):
        result = format_message("alice@ex.com", "alice@ex.com", "Hello")
        self.assertEqual(result, "📧 alice@ex.com: Hello")

    def test_calendar_accepted(self):
        result = format_message("Bob <bob@ex.com>", "bob@ex.com", "Accepted: Team standup")
        self.assertIn("👍", result)
        self.assertIn("accepted", result)
        self.assertIn("Team standup", result)

    def test_calendar_declined(self):
        result = format_message("Bob <bob@ex.com>", "bob@ex.com", "Declined: Team standup")
        self.assertIn("👎", result)
        self.assertIn("declined", result)

    def test_calendar_tentative(self):
        result = format_message("Bob <bob@ex.com>", "bob@ex.com", "Tentative: Team standup")
        self.assertIn("🤷", result)
        self.assertIn("tentative", result)

    def test_skip_unsubscribe(self):
        self.assertIsNone(format_message("a", "a@b.com", "Unsubscribe confirmation"))

    def test_skip_noreply(self):
        self.assertIsNone(format_message("a", "a@b.com", "noreply notification"))

    def test_skip_no_reply(self):
        self.assertIsNone(format_message("a", "a@b.com", "no-reply message"))

    def test_case_insensitive_skip(self):
        self.assertIsNone(format_message("a", "a@b.com", "UNSUBSCRIBE NOW"))


# ---------------------------------------------------------------------------
# build_notify_email_action
# ---------------------------------------------------------------------------
class TestBuildNotifyEmailAction(unittest.TestCase):
    def test_emits_result(self):
        resolver = MagicMock(return_value="[inbox] ")
        action = build_notify_email_action(mailbox_prefix_resolver=resolver)

        env = _envelope(sender_name="Alice", sender_email="alice@ex.com", subject="Hi")
        ctx = _action_context(envelope=env)
        results = action(ctx, {})

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].kind, "message")
        self.assertIn("Alice", results[0].payload["message"])
        self.assertIn("[inbox]", results[0].payload["message"])

    def test_skips_filtered(self):
        resolver = MagicMock(return_value="")
        action = build_notify_email_action(mailbox_prefix_resolver=resolver)

        env = _envelope(subject="Unsubscribe please")
        ctx = _action_context(envelope=env)
        results = action(ctx, {})

        self.assertEqual(results, [])
        ctx.logger.assert_called_once()
        self.assertIn("skipped", ctx.logger.call_args[0][0])

    def test_no_sender_name_uses_email(self):
        resolver = MagicMock(return_value="")
        action = build_notify_email_action(mailbox_prefix_resolver=resolver)

        env = _envelope(sender_name="", sender_email="bob@ex.com", subject="Hey")
        ctx = _action_context(envelope=env)
        results = action(ctx, {})

        self.assertEqual(len(results), 1)
        self.assertIn("bob@ex.com", results[0].payload["message"])


# ---------------------------------------------------------------------------
# build_detect_tracking_action
# ---------------------------------------------------------------------------
class TestBuildDetectTrackingAction(unittest.TestCase):
    def test_delivery_triggers_remove(self):
        mock_client = MagicMock()
        mock_client.scan_text_for_tracking_numbers.return_value = [
            {"tracking_number": "1Z999", "carrier": "UPS"}
        ]
        mock_client.remove_package.return_value = {"success": True}

        label_resolver = MagicMock(return_value="TestAcct")
        action = build_detect_tracking_action(
            account_label_resolver=label_resolver,
            tracking_client_loader=lambda: mock_client,
        )

        env = _envelope(subject="Your package has been delivered", body_text="1Z999")
        ctx = _action_context(envelope=env)
        results = action(ctx, {})

        self.assertEqual(len(results), 1)
        self.assertIn("delivered", results[0].payload["message"].lower())
        mock_client.remove_package.assert_called_once_with("1Z999")

    def test_non_delivery_triggers_add(self):
        mock_client = MagicMock()
        mock_client.is_shipping_sender.return_value = True
        mock_client.scan_text_for_tracking_numbers.return_value = [
            {"tracking_number": "1Z999", "carrier": "UPS"}
        ]
        mock_client.extract_tracking_from_urls.return_value = []
        mock_client.add_package.return_value = {"success": True}

        label_resolver = MagicMock(return_value="TestAcct")
        action = build_detect_tracking_action(
            account_label_resolver=label_resolver,
            tracking_client_loader=lambda: mock_client,
        )

        env = _envelope(
            subject="Your package is on its way",
            sender_email="tracking@fedex.com",
            body_text="Track: 1Z999",
        )
        ctx = _action_context(envelope=env)
        results = action(ctx, {})

        self.assertEqual(len(results), 1)
        self.assertIn("registered", results[0].payload["message"].lower())
        mock_client.add_package.assert_called_once()

    def test_delivery_no_tracking_found(self):
        mock_client = MagicMock()
        mock_client.scan_text_for_tracking_numbers.return_value = []

        label_resolver = MagicMock(return_value="TestAcct")
        action = build_detect_tracking_action(
            account_label_resolver=label_resolver,
            tracking_client_loader=lambda: mock_client,
        )

        env = _envelope(subject="Package delivered", body_text="No tracking here")
        ctx = _action_context(envelope=env)
        results = action(ctx, {})

        self.assertEqual(results, [])


if __name__ == "__main__":
    unittest.main()
