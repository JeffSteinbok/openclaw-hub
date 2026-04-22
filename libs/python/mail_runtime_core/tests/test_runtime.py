#!/usr/bin/env python3
"""Tests for runtime.py"""

import sys
import os
import re
import shutil
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch, call

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from mail_runtime_core.runtime import (
    ActionContext,
    ActionRegistry,
    ActionResult,
    MailEnvelope,
    RegisteredAction,
    execute_rules,
    normalize_action,
    rule_matches,
    select_matching_rules,
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


# ---------------------------------------------------------------------------
# normalize_action
# ---------------------------------------------------------------------------
class TestNormalizeAction(unittest.TestCase):
    def test_string_action(self):
        name, params = normalize_action("do_thing")
        self.assertEqual(name, "do_thing")
        self.assertEqual(params, {})

    def test_dict_action_with_params(self):
        name, params = normalize_action({"name": "do_thing", "params": {"k": "v"}})
        self.assertEqual(name, "do_thing")
        self.assertEqual(params, {"k": "v"})

    def test_dict_action_without_params(self):
        name, params = normalize_action({"name": "do_thing"})
        self.assertEqual(name, "do_thing")
        self.assertEqual(params, {})


# ---------------------------------------------------------------------------
# ActionRegistry
# ---------------------------------------------------------------------------
class TestActionRegistry(unittest.TestCase):
    def test_register_and_get(self):
        reg = ActionRegistry()
        handler = MagicMock()
        reg.register("my_action", handler, needs_body=True)
        action = reg.get("my_action")
        self.assertIsInstance(action, RegisteredAction)
        self.assertEqual(action.name, "my_action")
        self.assertTrue(action.needs_body)
        self.assertIs(action.handler, handler)

    def test_get_unknown_raises(self):
        reg = ActionRegistry()
        with self.assertRaises(KeyError) as ctx:
            reg.get("missing")
        self.assertIn("Unknown mail action", str(ctx.exception))

    def test_register_with_attachment_request(self):
        reg = ActionRegistry()
        handler = MagicMock()
        req = {"content_types": ["image/png"]}
        reg.register("img_action", handler, attachment_request=req)
        action = reg.get("img_action")
        self.assertEqual(action.attachment_request, req)
        self.assertFalse(action.needs_body)


# ---------------------------------------------------------------------------
# rule_matches
# ---------------------------------------------------------------------------
class TestRuleMatches(unittest.TestCase):
    def test_empty_match_returns_true(self):
        self.assertTrue(rule_matches(_envelope(), {"match": {}}))

    def test_no_match_key_returns_true(self):
        self.assertTrue(rule_matches(_envelope(), {}))

    def test_sender_email_exact(self):
        rule = {"match": {"sender_email": "alice@example.com"}}
        self.assertTrue(rule_matches(_envelope(), rule))
        self.assertFalse(rule_matches(_envelope(sender_email="bob@example.com"), rule))

    def test_sender_email_case_insensitive(self):
        rule = {"match": {"sender_email": "Alice@Example.COM"}}
        self.assertTrue(rule_matches(_envelope(sender_email="alice@example.com"), rule))

    def test_sender_domain(self):
        rule = {"match": {"sender_domain": "example.com"}}
        self.assertTrue(rule_matches(_envelope(sender_email="alice@example.com"), rule))
        self.assertFalse(rule_matches(_envelope(sender_email="alice@other.com"), rule))

    def test_sender_domain_subdomain(self):
        rule = {"match": {"sender_domain": "example.com"}}
        self.assertTrue(rule_matches(_envelope(sender_email="alice@mail.example.com"), rule))

    def test_sender_name_contains(self):
        rule = {"match": {"sender_name_contains": "alice"}}
        self.assertTrue(rule_matches(_envelope(sender_name="Alice Smith"), rule))
        self.assertFalse(rule_matches(_envelope(sender_name="Bob Jones"), rule))

    def test_subject_exact(self):
        rule = {"match": {"subject": "Hello World"}}
        self.assertTrue(rule_matches(_envelope(), rule))
        self.assertFalse(rule_matches(_envelope(subject="Hello"), rule))

    def test_subject_contains(self):
        rule = {"match": {"subject_contains": "hello"}}
        self.assertTrue(rule_matches(_envelope(subject="Say Hello Friend"), rule))
        self.assertFalse(rule_matches(_envelope(subject="Goodbye"), rule))

    def test_subject_prefix(self):
        rule = {"match": {"subject_prefix": "hello"}}
        self.assertTrue(rule_matches(_envelope(subject="Hello World"), rule))
        self.assertFalse(rule_matches(_envelope(subject="World Hello"), rule))

    def test_subject_regex(self):
        rule = {"match": {"subject_regex": r"order\s*#\d+"}}
        self.assertTrue(rule_matches(_envelope(subject="Order #123 shipped"), rule))
        self.assertFalse(rule_matches(_envelope(subject="No order here"), rule))

    def test_body_contains(self):
        rule = {"match": {"body_contains": "special"}}
        self.assertTrue(rule_matches(_envelope(body_text="Something special here"), rule))
        self.assertFalse(rule_matches(_envelope(body_text="Nothing here"), rule))

    def test_body_contains_html(self):
        rule = {"match": {"body_contains": "special"}}
        self.assertTrue(rule_matches(_envelope(body_html="<b>special</b>"), rule))

    def test_has_attachments_true(self):
        rule = {"match": {"has_attachments": True}}
        self.assertTrue(rule_matches(_envelope(has_attachments=True), rule))
        self.assertFalse(rule_matches(_envelope(has_attachments=False), rule))

    def test_has_attachments_false(self):
        rule = {"match": {"has_attachments": False}}
        self.assertTrue(rule_matches(_envelope(has_attachments=False), rule))
        self.assertFalse(rule_matches(_envelope(has_attachments=True), rule))

    def test_providers_filter(self):
        rule = {"providers": "test-provider"}
        self.assertTrue(rule_matches(_envelope(provider="test-provider"), rule))
        self.assertFalse(rule_matches(_envelope(provider="other"), rule))

    def test_accounts_filter(self):
        rule = {"accounts": "acct-1"}
        self.assertTrue(rule_matches(_envelope(account_id="acct-1"), rule))
        self.assertFalse(rule_matches(_envelope(account_id="acct-2"), rule))

    def test_mailboxes_filter(self):
        rule = {"mailboxes": "inbox"}
        self.assertTrue(rule_matches(_envelope(mailbox_id="inbox"), rule))
        self.assertFalse(rule_matches(_envelope(mailbox_id="spam"), rule))

    def test_list_values(self):
        rule = {"match": {"sender_email": ["alice@example.com", "bob@example.com"]}}
        self.assertTrue(rule_matches(_envelope(sender_email="bob@example.com"), rule))

    def test_unsupported_condition(self):
        rule = {"match": {"nonexistent_key": "val"}}
        with self.assertRaises(ValueError):
            rule_matches(_envelope(), rule)


# ---------------------------------------------------------------------------
# select_matching_rules
# ---------------------------------------------------------------------------
class TestSelectMatchingRules(unittest.TestCase):
    def test_skips_disabled(self):
        rules = [
            {"id": "r1", "enabled": False, "match": {}},
            {"id": "r2", "match": {}},
        ]
        result = select_matching_rules(_envelope(), rules)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["id"], "r2")

    def test_stops_at_first_non_continue(self):
        rules = [
            {"id": "r1", "match": {}, "continue": True},
            {"id": "r2", "match": {}},
            {"id": "r3", "match": {}},
        ]
        result = select_matching_rules(_envelope(), rules)
        self.assertEqual([r["id"] for r in result], ["r1", "r2"])

    def test_all_continue(self):
        rules = [
            {"id": "r1", "match": {}, "continue": True},
            {"id": "r2", "match": {}, "continue": True},
        ]
        result = select_matching_rules(_envelope(), rules)
        self.assertEqual(len(result), 2)

    def test_no_match(self):
        rules = [{"id": "r1", "match": {"sender_email": "nobody@nowhere.com"}}]
        result = select_matching_rules(_envelope(), rules)
        self.assertEqual(result, [])

    def test_enabled_default_true(self):
        rules = [{"id": "r1", "match": {}}]
        result = select_matching_rules(_envelope(), rules)
        self.assertEqual(len(result), 1)


# ---------------------------------------------------------------------------
# execute_rules
# ---------------------------------------------------------------------------
class TestExecuteRules(unittest.TestCase):
    def setUp(self):
        self.workspace = Path("_test_workspace_execute_rules")
        self.workspace.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        if self.workspace.exists():
            shutil.rmtree(self.workspace)

    def test_happy_path(self):
        handler = MagicMock(return_value=[ActionResult(kind="log", payload={"message": "ok"})])
        registry = ActionRegistry()
        registry.register("my_action", handler)

        rules = [{"id": "r1", "match": {}, "actions": ["my_action"]}]
        provider = MagicMock()
        logger = MagicMock()

        matched, results = execute_rules(
            _envelope(), rules, registry, provider, workspace=self.workspace, logger=logger,
        )
        self.assertEqual(len(matched), 1)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].kind, "log")
        handler.assert_called_once()

    def test_needs_body(self):
        handler = MagicMock(return_value=[])
        registry = ActionRegistry()
        registry.register("body_action", handler, needs_body=True)

        rules = [{"id": "r1", "match": {}, "actions": ["body_action"]}]
        provider = MagicMock()
        provider.fetch_body.return_value = _envelope(body_text="fetched body")
        logger = MagicMock()

        execute_rules(
            _envelope(), rules, registry, provider, workspace=self.workspace, logger=logger,
        )
        provider.fetch_body.assert_called_once()

    def test_attachment_request_downloads_and_cleans(self):
        handler = MagicMock(return_value=[])
        req = {"content_types": ["image/png"]}
        registry = ActionRegistry()
        registry.register("img_action", handler, attachment_request=req)

        rules = [{"id": "r1", "match": {}, "actions": ["img_action"]}]
        provider = MagicMock()
        provider.download_attachments.return_value = ["file1.png"]
        logger = MagicMock()

        execute_rules(
            _envelope(), rules, registry, provider, workspace=self.workspace, logger=logger,
        )
        provider.download_attachments.assert_called_once()
        # The handler should have been called with artifacts
        ctx_arg = handler.call_args[0][0]
        self.assertIn("download_dir", ctx_arg.artifacts)
        self.assertEqual(ctx_arg.artifacts["downloaded_files"], ["file1.png"])

    def test_keep_downloads_skips_cleanup(self):
        handler = MagicMock(return_value=[])
        req = {"content_types": ["image/png"]}
        registry = ActionRegistry()
        registry.register("img_action", handler, attachment_request=req)

        rules = [
            {
                "id": "r1",
                "match": {},
                "actions": [{"name": "img_action", "params": {"keep_downloads": True}}],
            }
        ]
        provider = MagicMock()
        provider.download_attachments.return_value = ["file1.png"]
        logger = MagicMock()

        execute_rules(
            _envelope(), rules, registry, provider, workspace=self.workspace, logger=logger,
        )
        # The temp dir should still exist because keep_downloads is True
        ctx_arg = handler.call_args[0][0]
        download_dir = ctx_arg.artifacts["download_dir"]
        self.assertTrue(os.path.isdir(download_dir))
        # Clean up manually
        shutil.rmtree(download_dir, ignore_errors=True)

    def test_no_matching_rules(self):
        registry = ActionRegistry()
        rules = [{"id": "r1", "match": {"sender_email": "nobody@nowhere.com"}}]
        provider = MagicMock()
        logger = MagicMock()

        matched, results = execute_rules(
            _envelope(), rules, registry, provider, workspace=self.workspace, logger=logger,
        )
        self.assertEqual(matched, [])
        self.assertEqual(results, [])

    def test_config_passed_to_context(self):
        handler = MagicMock(return_value=[])
        registry = ActionRegistry()
        registry.register("cfg_action", handler)

        rules = [{"id": "r1", "match": {}, "actions": ["cfg_action"]}]
        provider = MagicMock()
        logger = MagicMock()
        config = {"key": "value"}

        execute_rules(
            _envelope(), rules, registry, provider,
            workspace=self.workspace, logger=logger, config=config,
        )
        ctx_arg = handler.call_args[0][0]
        self.assertEqual(ctx_arg.config, {"key": "value"})


if __name__ == "__main__":
    unittest.main()
