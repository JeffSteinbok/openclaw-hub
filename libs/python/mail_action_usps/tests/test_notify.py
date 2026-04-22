#!/usr/bin/env python3
"""Tests for mail_action_usps.notify module."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from mail_action_usps.notify import _classify_recipient, build_notification_plan


class TestClassifyRecipient(unittest.TestCase):
    def test_jeff(self):
        self.assertEqual(_classify_recipient("Jeff Steinbok"), "jeff")

    def test_jeffrey(self):
        self.assertEqual(_classify_recipient("Jeffrey Steinbok"), "jeff")

    def test_nicole(self):
        self.assertEqual(_classify_recipient("Nicole Smith"), "nicole")

    def test_eastside_improv(self):
        self.assertEqual(_classify_recipient("Eastside Improv"), "nicole")

    def test_joint_jeffrey_and_nicole(self):
        self.assertEqual(_classify_recipient("Jeffrey & Nicole Steinbok"), "jeff")

    def test_joint_jeff_and_nicole(self):
        self.assertEqual(_classify_recipient("Jeff & Nicole"), "jeff")

    def test_default_unknown(self):
        self.assertEqual(_classify_recipient("Current Resident"), "jeff")

    def test_empty(self):
        self.assertEqual(_classify_recipient(""), "jeff")

    def test_none(self):
        self.assertEqual(_classify_recipient(None), "jeff")

    def test_case_insensitive(self):
        self.assertEqual(_classify_recipient("NICOLE JONES"), "nicole")


class TestBuildNotificationPlan(unittest.TestCase):
    def _config(self):
        return {
            "routing": {
                "jeff": {"channel": "discord", "target": "jeff-target"},
                "nicole": {"channel": "discord", "target": "nicole-target"},
                "default": {"channel": "discord", "target": "default-target"},
            }
        }

    def test_important_items_notified(self):
        items = [
            {"sender": "IRS", "addressee": "Jeff", "importance": "urgent", "description": "Tax notice"},
            {"sender": "ACME", "addressee": "Jeff", "importance": "junk"},
        ]
        plan = build_notification_plan("2024-01-15", items, config=self._config())
        self.assertEqual(len(plan), 1)
        self.assertEqual(plan[0]["recipient"], "jeff")
        self.assertIn("IRS", plan[0]["message"])
        self.assertEqual(len(plan[0]["items"]), 1)

    def test_no_important_items_no_plan(self):
        items = [
            {"sender": "ACME", "addressee": "Jeff", "importance": "junk"},
            {"sender": "Flyer", "addressee": "Jeff", "importance": "ad"},
        ]
        plan = build_notification_plan("2024-01-15", items, config=self._config())
        self.assertEqual(len(plan), 0)

    def test_nicole_routing(self):
        items = [
            {"sender": "Bank", "addressee": "Nicole Smith", "importance": "high", "description": "Statement"},
        ]
        plan = build_notification_plan("2024-01-15", items, config=self._config())
        self.assertEqual(len(plan), 1)
        self.assertEqual(plan[0]["recipient"], "nicole")
        self.assertEqual(plan[0]["target"], "nicole-target")

    def test_junk_summary_for_jeff(self):
        items = [
            {"sender": "IRS", "addressee": "Jeff", "importance": "urgent"},
            {"sender": "Junk Co", "addressee": "Jeff", "importance": "junk"},
            {"sender": "Ad Co", "addressee": "Jeff", "importance": "ad"},
            {"sender": "Routine", "addressee": "Jeff", "importance": "medium"},
        ]
        plan = build_notification_plan("2024-01-15", items, config=self._config())
        jeff_plan = [p for p in plan if p["recipient"] == "jeff"][0]
        self.assertIn("Also:", jeff_plan["message"])
        self.assertIn("junk", jeff_plan["message"])

    def test_no_junk_summary_for_nicole(self):
        items = [
            {"sender": "Bank", "addressee": "Nicole", "importance": "high"},
            {"sender": "Junk", "addressee": "Nicole", "importance": "junk"},
        ]
        plan = build_notification_plan("2024-01-15", items, config=self._config())
        nicole_plans = [p for p in plan if p["recipient"] == "nicole"]
        if nicole_plans:
            self.assertNotIn("Also:", nicole_plans[0]["message"])

    def test_requires_config_or_agent(self):
        with self.assertRaises(ValueError):
            build_notification_plan("2024-01-15", [])

    def test_multiple_recipients(self):
        items = [
            {"sender": "IRS", "addressee": "Jeff", "importance": "urgent"},
            {"sender": "Bank", "addressee": "Nicole", "importance": "high"},
        ]
        plan = build_notification_plan("2024-01-15", items, config=self._config())
        recipients = {p["recipient"] for p in plan}
        self.assertEqual(recipients, {"jeff", "nicole"})


if __name__ == "__main__":
    unittest.main()
