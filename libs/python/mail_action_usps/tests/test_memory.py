#!/usr/bin/env python3
"""Tests for mail_action_usps.memory module."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from mail_action_usps.memory import (
    get_stats,
    load_analysis,
    load_state,
    lookup,
    make_guid,
    save_analysis,
    save_state,
    save_to_analysis,
    update_state,
    write_memory_for_date,
)


def _patch_paths(tmpdir):
    """Return a stack of patches that redirect all path functions to tmpdir."""
    memory_dir = Path(tmpdir) / "memory"
    memory_dir.mkdir(parents=True, exist_ok=True)
    ltm_dir = memory_dir / "mail"
    ltm_dir.mkdir(parents=True, exist_ok=True)

    return [
        patch("mail_action_usps.memory.get_analysis_file", return_value=memory_dir / "usps_analysis.json"),
        patch("mail_action_usps.memory.get_long_term_memory_dir", return_value=ltm_dir),
        patch("mail_action_usps.memory.get_state_file", return_value=memory_dir / "usps_state.json"),
    ]


class TestMakeGuid(unittest.TestCase):
    def test_deterministic(self):
        g1 = make_guid("2024-01-15", "image001.jpg")
        g2 = make_guid("2024-01-15", "image001.jpg")
        self.assertEqual(g1, g2)

    def test_different_inputs_differ(self):
        g1 = make_guid("2024-01-15", "image001.jpg")
        g2 = make_guid("2024-01-15", "image002.jpg")
        self.assertNotEqual(g1, g2)

    def test_different_dates_differ(self):
        g1 = make_guid("2024-01-15", "image001.jpg")
        g2 = make_guid("2024-01-16", "image001.jpg")
        self.assertNotEqual(g1, g2)

    def test_returns_string(self):
        g = make_guid("2024-01-15", "test.jpg")
        self.assertIsInstance(g, str)
        self.assertEqual(len(g), 36)  # UUID format


class TestAnalysisRoundTrip(unittest.TestCase):
    def test_save_and_load(self):
        with tempfile.TemporaryDirectory() as td:
            patches = _patch_paths(td)
            for p in patches:
                p.start()
            try:
                data = {
                    "2024-01-15": {
                        "img001.jpg": {"sender": "ACME", "importance": "high"},
                        "img002.jpg": {"sender": "Bank", "importance": "medium"},
                    }
                }
                save_analysis(data, "test")
                loaded = load_analysis("test")
                self.assertEqual(loaded, data)
            finally:
                for p in patches:
                    p.stop()

    def test_load_empty(self):
        with tempfile.TemporaryDirectory() as td:
            patches = _patch_paths(td)
            for p in patches:
                p.start()
            try:
                loaded = load_analysis("test")
                self.assertEqual(loaded, {})
            finally:
                for p in patches:
                    p.stop()

    def test_v2_format(self):
        with tempfile.TemporaryDirectory() as td:
            patches = _patch_paths(td)
            for p in patches:
                p.start()
            try:
                analysis_file = Path(td) / "memory" / "usps_analysis.json"
                v2_data = {
                    "_meta": {"version": 2},
                    "data": {
                        "2024-01-15": {
                            "img001.jpg": {"sender": "ACME", "importance": "high"}
                        }
                    },
                }
                with open(analysis_file, "w") as f:
                    json.dump(v2_data, f)

                loaded = load_analysis("test")
                self.assertIn("2024-01-15", loaded)
                self.assertNotIn("_meta", loaded)
            finally:
                for p in patches:
                    p.stop()

    def test_flat_format_filters_meta(self):
        with tempfile.TemporaryDirectory() as td:
            patches = _patch_paths(td)
            for p in patches:
                p.start()
            try:
                analysis_file = Path(td) / "memory" / "usps_analysis.json"
                flat_data = {
                    "_meta_version": "1.0",
                    "2024-01-15": {
                        "img001.jpg": {"sender": "ACME"}
                    },
                }
                with open(analysis_file, "w") as f:
                    json.dump(flat_data, f)

                loaded = load_analysis("test")
                self.assertIn("2024-01-15", loaded)
                self.assertNotIn("_meta_version", loaded)
            finally:
                for p in patches:
                    p.stop()


class TestSaveToAnalysis(unittest.TestCase):
    def test_merge(self):
        with tempfile.TemporaryDirectory() as td:
            patches = _patch_paths(td)
            for p in patches:
                p.start()
            try:
                save_to_analysis("2024-01-15", {"img001.jpg": {"sender": "A"}}, "test")
                save_to_analysis("2024-01-15", {"img002.jpg": {"sender": "B"}}, "test")
                loaded = load_analysis("test")
                self.assertEqual(len(loaded["2024-01-15"]), 2)
            finally:
                for p in patches:
                    p.stop()


class TestWriteMemoryForDate(unittest.TestCase):
    def test_creates_file(self):
        with tempfile.TemporaryDirectory() as td:
            patches = _patch_paths(td)
            for p in patches:
                p.start()
            try:
                items = [{"sender": "ACME", "addressee": "Jeff", "importance": "high", "description": "Invoice"}]
                result = write_memory_for_date("2024-01-15", items, "test")
                self.assertTrue(os.path.exists(result))
                content = open(result).read()
                self.assertIn("ACME", content)
                self.assertIn("Jeff", content)
                self.assertIn("2024-01-15", content)
            finally:
                for p in patches:
                    p.stop()

    def test_idempotent(self):
        with tempfile.TemporaryDirectory() as td:
            patches = _patch_paths(td)
            for p in patches:
                p.start()
            try:
                items = [{"sender": "ACME", "addressee": "Jeff", "importance": "high"}]
                write_memory_for_date("2024-01-15", items, "test")
                write_memory_for_date("2024-01-15", items, "test")
                content = open(Path(td) / "memory" / "mail" / "mail_memory_2024-01.md").read()
                # Date header should appear only once
                self.assertEqual(content.count("2024-01-15"), 1)
            finally:
                for p in patches:
                    p.stop()


class TestLookup(unittest.TestCase):
    def _setup_data(self, td):
        patches = _patch_paths(td)
        for p in patches:
            p.start()
        data = {
            "2024-01-15": {
                "img001.jpg": {"sender": "ACME", "importance": "high", "guid": make_guid("2024-01-15", "img001.jpg")},
                "img002.jpg": {"sender": "Bank", "importance": "medium"},
            },
            "2024-01-16": {
                "img003.jpg": {"sender": "IRS", "importance": "urgent"},
            },
        }
        save_analysis(data, "test")
        return patches

    def test_lookup_by_date(self):
        with tempfile.TemporaryDirectory() as td:
            patches = self._setup_data(td)
            try:
                results = lookup(date="2024-01-15", workspace_agent="test")
                self.assertEqual(len(results), 2)
            finally:
                for p in patches:
                    p.stop()

    def test_lookup_by_search(self):
        with tempfile.TemporaryDirectory() as td:
            patches = self._setup_data(td)
            try:
                results = lookup(search="irs", workspace_agent="test")
                self.assertEqual(len(results), 1)
                self.assertEqual(results[0][2]["sender"], "IRS")
            finally:
                for p in patches:
                    p.stop()

    def test_lookup_by_guid(self):
        with tempfile.TemporaryDirectory() as td:
            patches = self._setup_data(td)
            try:
                target_guid = make_guid("2024-01-15", "img001.jpg")
                results = lookup(guid=target_guid, workspace_agent="test")
                self.assertEqual(len(results), 1)
                self.assertEqual(results[0][2]["sender"], "ACME")
            finally:
                for p in patches:
                    p.stop()

    def test_lookup_no_match(self):
        with tempfile.TemporaryDirectory() as td:
            patches = self._setup_data(td)
            try:
                results = lookup(search="nonexistent", workspace_agent="test")
                self.assertEqual(len(results), 0)
            finally:
                for p in patches:
                    p.stop()

    def test_lookup_requires_agent(self):
        with self.assertRaises(ValueError):
            lookup(search="test")


class TestGetStats(unittest.TestCase):
    def test_stats(self):
        with tempfile.TemporaryDirectory() as td:
            patches = _patch_paths(td)
            for p in patches:
                p.start()
            try:
                data = {
                    "2024-01-15": {
                        "img001.jpg": {"sender": "ACME", "addressee": "Jeff", "importance": "high"},
                        "img002.jpg": {"sender": "ACME", "addressee": "Nicole", "importance": "junk"},
                    },
                    "2024-01-16": {
                        "img003.jpg": {"sender": "IRS", "addressee": "Jeff", "importance": "urgent"},
                    },
                }
                save_analysis(data, "test")
                stats = get_stats(workspace_agent="test")
                self.assertEqual(stats["total_pieces"], 3)
                self.assertEqual(stats["delivery_days"], 2)
                self.assertEqual(stats["by_importance"]["high"], 1)
                self.assertEqual(stats["by_importance"]["junk"], 1)
                self.assertEqual(stats["top_senders"]["ACME"], 2)
                self.assertEqual(stats["top_addressees"]["Jeff"], 2)
            finally:
                for p in patches:
                    p.stop()

    def test_stats_empty(self):
        with tempfile.TemporaryDirectory() as td:
            patches = _patch_paths(td)
            for p in patches:
                p.start()
            try:
                stats = get_stats(workspace_agent="test")
                self.assertEqual(stats["total_pieces"], 0)
                self.assertEqual(stats["delivery_days"], 0)
            finally:
                for p in patches:
                    p.stop()

    def test_stats_requires_agent(self):
        with self.assertRaises(ValueError):
            get_stats()


class TestStateRoundTrip(unittest.TestCase):
    def test_save_and_load(self):
        with tempfile.TemporaryDirectory() as td:
            patches = _patch_paths(td)
            for p in patches:
                p.start()
            try:
                state = {"last_checked_at": "2024-01-15T12:00:00Z", "last_message_id": "abc123"}
                save_state(state, "test")
                loaded = load_state("test")
                self.assertEqual(loaded, state)
            finally:
                for p in patches:
                    p.stop()

    def test_load_missing(self):
        with tempfile.TemporaryDirectory() as td:
            patches = _patch_paths(td)
            for p in patches:
                p.start()
            try:
                loaded = load_state("test")
                self.assertEqual(loaded, {})
            finally:
                for p in patches:
                    p.stop()

    def test_update_state(self):
        with tempfile.TemporaryDirectory() as td:
            patches = _patch_paths(td)
            for p in patches:
                p.start()
            try:
                update_state(
                    last_checked_at="2024-01-15T12:00:00Z",
                    message_id="msg001",
                    date_processed="2024-01-15",
                    workspace_agent="test",
                )
                state = load_state("test")
                self.assertEqual(state["last_checked_at"], "2024-01-15T12:00:00Z")
                self.assertEqual(state["last_message_id"], "msg001")
                self.assertIn("msg001", state["processed_message_ids"])
                self.assertEqual(state["last_date_processed"], "2024-01-15")
            finally:
                for p in patches:
                    p.stop()

    def test_update_state_dedup(self):
        with tempfile.TemporaryDirectory() as td:
            patches = _patch_paths(td)
            for p in patches:
                p.start()
            try:
                update_state(message_id="msg001", workspace_agent="test")
                update_state(message_id="msg001", workspace_agent="test")
                state = load_state("test")
                self.assertEqual(state["processed_message_ids"].count("msg001"), 1)
            finally:
                for p in patches:
                    p.stop()

    def test_update_state_requires_agent(self):
        with self.assertRaises(ValueError):
            update_state(last_checked_at="now")


if __name__ == "__main__":
    unittest.main()
