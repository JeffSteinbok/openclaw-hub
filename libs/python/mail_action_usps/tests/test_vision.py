#!/usr/bin/env python3
"""Tests for mail_action_usps.vision module (validate_analysis only)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from mail_action_usps.vision import validate_analysis


class TestValidateAnalysis(unittest.TestCase):
    def test_all_fields_present(self):
        analysis = {
            "sender": "ACME",
            "addressee": "Jeff",
            "description": "Invoice",
            "type": "scan",
            "importance": "high",
            "mail_class": "First-Class",
            "address_method": "printed",
        }
        result = validate_analysis(analysis)
        self.assertEqual(result["sender"], "ACME")
        self.assertEqual(result["addressee"], "Jeff")
        self.assertEqual(result["importance"], "high")

    def test_missing_fields_get_defaults(self):
        result = validate_analysis({"sender": "ACME"})
        self.assertEqual(result["sender"], "ACME")
        self.assertEqual(result["addressee"], "Unknown")
        self.assertEqual(result["description"], "")
        self.assertEqual(result["type"], "scan")
        self.assertEqual(result["importance"], "medium")
        self.assertEqual(result["mail_class"], "Unknown")
        self.assertEqual(result["address_method"], "")

    def test_empty_dict(self):
        result = validate_analysis({})
        self.assertEqual(result["sender"], "Unknown")
        self.assertEqual(result["addressee"], "Unknown")
        self.assertEqual(result["importance"], "medium")
        self.assertEqual(result["type"], "scan")

    def test_extra_fields_not_included(self):
        result = validate_analysis({"sender": "X", "extra_field": "should_be_gone"})
        self.assertNotIn("extra_field", result)

    def test_returns_new_dict(self):
        original = {"sender": "ACME", "importance": "high"}
        result = validate_analysis(original)
        self.assertIsNot(result, original)

    def test_all_default_keys_present(self):
        result = validate_analysis({})
        expected_keys = {"sender", "addressee", "description", "type", "importance", "mail_class", "address_method"}
        self.assertEqual(set(result.keys()), expected_keys)


if __name__ == "__main__":
    unittest.main()
