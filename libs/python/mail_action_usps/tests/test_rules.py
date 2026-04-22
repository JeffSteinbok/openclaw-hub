#!/usr/bin/env python3
"""Tests for mail_action_usps.rules module."""

import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from mail_action_usps.rules import (
    add_rule,
    apply_rules,
    list_rules,
    load_rules,
    remove_rule,
    save_rules,
    test_rule,
)


class TestLoadRules(unittest.TestCase):
    def test_missing_file_returns_empty(self):
        rules, version = load_rules(rules_path="/nonexistent/path/rules.json")
        self.assertEqual(rules, [])
        self.assertEqual(version, "0")

    def test_valid_dict_format(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump({"version": "2.3", "rules": [{"addressee_contains": "smith", "importance": "low"}]}, f)
            f.flush()
            path = f.name
        try:
            rules, version = load_rules(rules_path=path)
            self.assertEqual(len(rules), 1)
            self.assertEqual(version, "2.3")
            self.assertEqual(rules[0]["importance"], "low")
        finally:
            os.unlink(path)

    def test_flat_list_format(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump([{"addressee_contains": "x", "importance": "high"}], f)
            f.flush()
            path = f.name
        try:
            rules, version = load_rules(rules_path=path)
            self.assertEqual(len(rules), 1)
            self.assertEqual(version, "0")
        finally:
            os.unlink(path)

    def test_no_path_no_agent_raises(self):
        with self.assertRaises(ValueError):
            load_rules()


class TestSaveAndLoadRoundTrip(unittest.TestCase):
    def test_round_trip(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "rules.json")
            rules = [{"sender_contains": "acme", "importance": "junk", "_comment": "Acme junk"}]
            save_rules(rules, "3.1", rules_path=path)

            loaded, ver = load_rules(rules_path=path)
            self.assertEqual(ver, "3.1")
            self.assertEqual(len(loaded), 1)
            self.assertEqual(loaded[0]["sender_contains"], "acme")


class TestApplyRules(unittest.TestCase):
    def test_no_rules_returns_original(self):
        info = {"sender": "ACME", "importance": "medium"}
        result = apply_rules(info, rules=[])
        self.assertEqual(result["importance"], "medium")

    def test_contains_match(self):
        rules = [{"sender_contains": "acme", "importance": "junk"}]
        info = {"sender": "ACME Corp", "importance": "medium"}
        result = apply_rules(info, rules=rules)
        self.assertEqual(result["importance"], "junk")

    def test_contains_no_match(self):
        rules = [{"sender_contains": "xyz", "importance": "junk"}]
        info = {"sender": "ACME Corp", "importance": "medium"}
        result = apply_rules(info, rules=rules)
        self.assertEqual(result["importance"], "medium")

    def test_not_contains_match(self):
        rules = [{"sender_not_contains": "acme", "importance": "high"}]
        info = {"sender": "Bank of America", "importance": "medium"}
        result = apply_rules(info, rules=rules)
        self.assertEqual(result["importance"], "high")

    def test_not_contains_no_match(self):
        rules = [{"sender_not_contains": "bank", "importance": "high"}]
        info = {"sender": "Bank of America", "importance": "medium"}
        result = apply_rules(info, rules=rules)
        self.assertEqual(result["importance"], "medium")

    def test_equals_match(self):
        rules = [{"mail_class_equals": "first-class", "importance": "high"}]
        info = {"mail_class": "First-Class", "importance": "medium"}
        result = apply_rules(info, rules=rules)
        self.assertEqual(result["importance"], "high")

    def test_equals_no_match(self):
        rules = [{"mail_class_equals": "first-class", "importance": "high"}]
        info = {"mail_class": "Standard", "importance": "medium"}
        result = apply_rules(info, rules=rules)
        self.assertEqual(result["importance"], "medium")

    def test_not_equals_match(self):
        rules = [{"mail_class_not_equals": "standard", "importance": "high"}]
        info = {"mail_class": "First-Class", "importance": "medium"}
        result = apply_rules(info, rules=rules)
        self.assertEqual(result["importance"], "high")

    def test_not_equals_no_match(self):
        rules = [{"mail_class_not_equals": "first-class", "importance": "high"}]
        info = {"mail_class": "First-Class", "importance": "medium"}
        result = apply_rules(info, rules=rules)
        self.assertEqual(result["importance"], "medium")

    def test_first_match_wins(self):
        rules = [
            {"sender_contains": "acme", "importance": "low"},
            {"sender_contains": "acme", "importance": "high"},
        ]
        info = {"sender": "ACME Corp"}
        result = apply_rules(info, rules=rules)
        self.assertEqual(result["importance"], "low")

    def test_multiple_conditions_and(self):
        rules = [{"sender_contains": "acme", "addressee_contains": "jeff", "importance": "urgent"}]
        info_match = {"sender": "ACME Corp", "addressee": "Jeff Smith"}
        info_partial = {"sender": "ACME Corp", "addressee": "Nicole Smith"}
        self.assertEqual(apply_rules(info_match, rules=rules)["importance"], "urgent")
        self.assertNotEqual(apply_rules(info_partial, rules=rules).get("importance"), "urgent")

    def test_comment_field_ignored(self):
        rules = [{"_comment": "test rule", "sender_contains": "acme", "importance": "junk"}]
        info = {"sender": "ACME Corp"}
        result = apply_rules(info, rules=rules)
        self.assertEqual(result["importance"], "junk")

    def test_does_not_mutate_original(self):
        rules = [{"sender_contains": "acme", "importance": "junk"}]
        info = {"sender": "ACME Corp", "importance": "medium"}
        result = apply_rules(info, rules=rules)
        self.assertEqual(info["importance"], "medium")
        self.assertEqual(result["importance"], "junk")


class TestAddAndRemoveRule(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.rules_path = os.path.join(self.tmpdir, "usps-mail", "rules.json")
        os.makedirs(os.path.join(self.tmpdir, "usps-mail"), exist_ok=True)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _patch_rules_file(self):
        from pathlib import Path
        return patch("mail_action_usps.rules.get_rules_file", return_value=Path(self.rules_path))

    def test_add_bumps_version(self):
        with self._patch_rules_file():
            result = add_rule({"sender_contains": "acme"}, "junk", comment="Block ACME", workspace_agent="test")
            self.assertEqual(result["action"], "added")
            self.assertEqual(result["version"], "1.0")
            self.assertEqual(result["rule_index"], 0)

            result2 = add_rule({"sender_contains": "xyz"}, "low", workspace_agent="test")
            self.assertEqual(result2["version"], "1.1")
            self.assertEqual(result2["rule_index"], 1)

    def test_remove_by_index(self):
        with self._patch_rules_file():
            add_rule({"sender_contains": "a"}, "low", comment="Rule A", workspace_agent="test")
            add_rule({"sender_contains": "b"}, "high", comment="Rule B", workspace_agent="test")

            result = remove_rule(index=0, workspace_agent="test")
            self.assertEqual(result["action"], "removed")
            self.assertIn("a", result["rule"]["sender_contains"])

            rules, _ = load_rules(rules_path=self.rules_path)
            self.assertEqual(len(rules), 1)

    def test_remove_by_comment(self):
        with self._patch_rules_file():
            add_rule({"sender_contains": "a"}, "low", comment="Block spam A", workspace_agent="test")
            add_rule({"sender_contains": "b"}, "high", comment="Allow B", workspace_agent="test")

            result = remove_rule(comment_match="spam", workspace_agent="test")
            self.assertEqual(result["action"], "removed")

            rules, _ = load_rules(rules_path=self.rules_path)
            self.assertEqual(len(rules), 1)
            self.assertEqual(rules[0]["_comment"], "Allow B")

    def test_remove_not_found(self):
        with self._patch_rules_file():
            result = remove_rule(index=99, workspace_agent="test")
            self.assertEqual(result["action"], "not_found")


class TestTestRule(unittest.TestCase):
    def test_matched(self):
        with tempfile.TemporaryDirectory() as td:
            from pathlib import Path
            rules_path = os.path.join(td, "rules.json")
            save_rules([{"sender_contains": "acme", "importance": "junk"}], "1.0", rules_path=rules_path)

            with patch("mail_action_usps.rules.get_rules_file", return_value=Path(rules_path)):
                result = test_rule({"sender": "ACME Corp", "importance": "medium"}, workspace_agent="test")
                self.assertTrue(result["rule_matched"])
                self.assertEqual(result["final_importance"], "junk")

    def test_not_matched(self):
        with tempfile.TemporaryDirectory() as td:
            from pathlib import Path
            rules_path = os.path.join(td, "rules.json")
            save_rules([{"sender_contains": "xyz", "importance": "junk"}], "1.0", rules_path=rules_path)

            with patch("mail_action_usps.rules.get_rules_file", return_value=Path(rules_path)):
                result = test_rule({"sender": "ACME Corp", "importance": "medium"}, workspace_agent="test")
                self.assertFalse(result["rule_matched"])
                self.assertEqual(result["final_importance"], "medium")


class TestListRules(unittest.TestCase):
    def test_list_returns_summary(self):
        with tempfile.TemporaryDirectory() as td:
            from pathlib import Path
            rules_path = os.path.join(td, "rules.json")
            save_rules(
                [
                    {"sender_contains": "acme", "importance": "junk", "_comment": "Block ACME"},
                    {"addressee_equals": "jeff", "importance": "high"},
                ],
                "2.0",
                rules_path=rules_path,
            )

            with patch("mail_action_usps.rules.get_rules_file", return_value=Path(rules_path)):
                result = list_rules(workspace_agent="test")
                self.assertEqual(result["version"], "2.0")
                self.assertEqual(result["count"], 2)
                self.assertEqual(result["rules"][0]["comment"], "Block ACME")
                self.assertEqual(result["rules"][0]["importance"], "junk")
                self.assertIn("sender_contains", result["rules"][0]["conditions"])
                self.assertEqual(result["rules"][1]["comment"], "")


if __name__ == "__main__":
    unittest.main()
