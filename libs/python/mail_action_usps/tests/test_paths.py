#!/usr/bin/env python3
"""Tests for mail_action_usps.paths module."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from mail_action_usps.paths import (
    get_analysis_file,
    get_config_file,
    get_long_term_memory_dir,
    get_memory_dir,
    get_rules_file,
    get_state_file,
    get_usps_dir,
    get_workspace_agent,
    get_workspace_root,
)


class TestGetWorkspaceAgent(unittest.TestCase):
    def test_valid_agent(self):
        self.assertEqual(get_workspace_agent("mail"), "mail")

    def test_none_raises(self):
        with self.assertRaises(ValueError):
            get_workspace_agent(None)

    def test_empty_string_raises(self):
        with self.assertRaises(ValueError):
            get_workspace_agent("")


class TestGetWorkspaceRoot(unittest.TestCase):
    def test_returns_path(self):
        p = get_workspace_root("mail")
        self.assertTrue(str(p).endswith("agents/mail/workspace"))

    def test_contains_home(self):
        p = get_workspace_root("mail")
        self.assertIn(".openclaw", str(p))

    def test_none_raises(self):
        with self.assertRaises(ValueError):
            get_workspace_root(None)


class TestDerivedPaths(unittest.TestCase):
    def test_memory_dir(self):
        p = get_memory_dir("x")
        self.assertTrue(str(p).endswith("workspace/memory"))

    def test_long_term_memory_dir(self):
        p = get_long_term_memory_dir("x")
        self.assertTrue(str(p).endswith("memory/mail"))

    def test_usps_dir(self):
        p = get_usps_dir("x")
        self.assertTrue(str(p).endswith("workspace/usps-mail"))

    def test_analysis_file(self):
        p = get_analysis_file("x")
        self.assertTrue(str(p).endswith("memory/usps_analysis.json"))

    def test_state_file(self):
        p = get_state_file("x")
        self.assertTrue(str(p).endswith("memory/usps_state.json"))

    def test_rules_file(self):
        p = get_rules_file("x")
        self.assertTrue(str(p).endswith("usps-mail/rules.json"))

    def test_config_file(self):
        p = get_config_file("x")
        self.assertTrue(str(p).endswith("usps-mail/config.json"))


class TestPathConsistency(unittest.TestCase):
    def test_analysis_file_under_memory(self):
        mem = get_memory_dir("a")
        ana = get_analysis_file("a")
        self.assertEqual(ana.parent, mem)

    def test_state_file_under_memory(self):
        mem = get_memory_dir("a")
        st = get_state_file("a")
        self.assertEqual(st.parent, mem)

    def test_rules_file_under_usps(self):
        usps = get_usps_dir("a")
        rf = get_rules_file("a")
        self.assertEqual(rf.parent, usps)

    def test_config_file_under_usps(self):
        usps = get_usps_dir("a")
        cf = get_config_file("a")
        self.assertEqual(cf.parent, usps)

    def test_different_agents_different_roots(self):
        r1 = get_workspace_root("alpha")
        r2 = get_workspace_root("beta")
        self.assertNotEqual(r1, r2)


if __name__ == "__main__":
    unittest.main()
