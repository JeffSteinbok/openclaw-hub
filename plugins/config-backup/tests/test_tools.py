"""Unit tests for the config-backup plugin (no network / git access required).

Covers:
  - compute_combined_hash: deterministic output, ordering, missing files
  - get_last_hash / save_hash: round-trip persistence
  - has_changed: detects new vs previously saved hash
  - handle_backup: check_only mode, missing source file, mocked subprocess
  - manifest: structure validation
"""

import hashlib
import os
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock

_SRC_DIR = os.path.join(os.path.dirname(__file__), "..", "src")
sys.path.insert(0, _SRC_DIR)

import backup_config
import tools


# ---------------------------------------------------------------------------
# compute_combined_hash
# ---------------------------------------------------------------------------

class TestComputeCombinedHash(unittest.TestCase):
    """compute_combined_hash produces a consistent SHA-256 over file contents."""

    def _write(self, tmp, name, content):
        path = os.path.join(tmp, name)
        with open(path, "w") as f:
            f.write(content)
        return path

    def test_hash_is_64_hex_chars(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write(tmp, "f.txt", "hello")
            result = backup_config.compute_combined_hash(path)
        self.assertEqual(len(result), 64)
        self.assertTrue(all(c in "0123456789abcdef" for c in result))

    def test_same_content_same_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            p1 = self._write(tmp, "a.txt", "data")
            p2 = self._write(tmp, "b.txt", "data")
            h1 = backup_config.compute_combined_hash(p1)
            h2 = backup_config.compute_combined_hash(p2)
        self.assertEqual(h1, h2)

    def test_different_content_different_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            p1 = self._write(tmp, "a.txt", "foo")
            p2 = self._write(tmp, "b.txt", "bar")
            h1 = backup_config.compute_combined_hash(p1)
            h2 = backup_config.compute_combined_hash(p2)
        self.assertNotEqual(h1, h2)

    def test_missing_file_silently_skipped(self):
        # Should not raise; missing file contributes no bytes
        result = backup_config.compute_combined_hash("/nonexistent/file.json")
        self.assertEqual(len(result), 64)

    def test_multiple_files_combined(self):
        with tempfile.TemporaryDirectory() as tmp:
            p1 = self._write(tmp, "a.txt", "part1")
            p2 = self._write(tmp, "b.txt", "part2")
            combined = backup_config.compute_combined_hash(p1, p2)
            single = backup_config.compute_combined_hash(p1)
        # Combined hash of two files differs from hash of just one
        self.assertNotEqual(combined, single)


# ---------------------------------------------------------------------------
# get_last_hash / save_hash
# ---------------------------------------------------------------------------

class TestHashPersistence(unittest.TestCase):
    """save_hash and get_last_hash form a round-trip."""

    def test_save_and_retrieve(self):
        with tempfile.NamedTemporaryFile(mode="w", delete=False, suffix=".hash") as tf:
            hash_path = tf.name
        try:
            with patch.object(backup_config, "HASH_FILE", hash_path):
                backup_config.save_hash("abc123def456" * 4)  # 48 chars, just for test
                retrieved = backup_config.get_last_hash()
            self.assertEqual(retrieved, "abc123def456" * 4)
        finally:
            os.unlink(hash_path)

    def test_missing_hash_file_returns_none(self):
        with patch.object(backup_config, "HASH_FILE", "/nonexistent/path/.hash"):
            result = backup_config.get_last_hash()
        self.assertIsNone(result)

    def test_empty_hash_file_returns_empty_string(self):
        with tempfile.NamedTemporaryFile(mode="w", delete=False, suffix=".hash") as tf:
            tf.write("")
            hash_path = tf.name
        try:
            with patch.object(backup_config, "HASH_FILE", hash_path):
                result = backup_config.get_last_hash()
            self.assertEqual(result, "")
        finally:
            os.unlink(hash_path)


# ---------------------------------------------------------------------------
# has_changed
# ---------------------------------------------------------------------------

class TestHasChanged(unittest.TestCase):
    """has_changed compares current file hash to the saved one."""

    def _write(self, path, content):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(content)

    def test_changed_when_no_saved_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "openclaw.json")
            self._write(src, '{"key": "value"}')
            hash_path = os.path.join(tmp, ".hash")
            with patch.object(backup_config, "SOURCE_FILE", src), \
                 patch.object(backup_config, "CRON_FILE", "/nonexistent/cron.json"), \
                 patch.object(backup_config, "FASTMAIL_SSE_CONFIG_FILE", "/nonexistent/fastmail-sse-config.json"), \
                 patch.object(backup_config, "HASH_FILE", hash_path):
                changed, current_hash = backup_config.has_changed()
        self.assertTrue(changed)
        self.assertEqual(len(current_hash), 64)

    def test_unchanged_when_hash_matches(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "openclaw.json")
            self._write(src, '{"key": "value"}')
            hash_path = os.path.join(tmp, ".hash")
            with patch.object(backup_config, "SOURCE_FILE", src), \
                 patch.object(backup_config, "CRON_FILE", "/nonexistent/cron.json"), \
                 patch.object(backup_config, "FASTMAIL_SSE_CONFIG_FILE", "/nonexistent/fastmail-sse-config.json"), \
                 patch.object(backup_config, "HASH_FILE", hash_path):
                # Compute and save the current hash
                current = backup_config.compute_combined_hash(
                    src,
                    "/nonexistent/cron.json",
                    "/nonexistent/fastmail-sse-config.json",
                )
                backup_config.save_hash(current)
                changed, _ = backup_config.has_changed()
        self.assertFalse(changed)

    def test_changed_after_file_modification(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "openclaw.json")
            self._write(src, '{"key": "old"}')
            hash_path = os.path.join(tmp, ".hash")
            with patch.object(backup_config, "SOURCE_FILE", src), \
                 patch.object(backup_config, "CRON_FILE", "/nonexistent/cron.json"), \
                 patch.object(backup_config, "FASTMAIL_SSE_CONFIG_FILE", "/nonexistent/fastmail-sse-config.json"), \
                 patch.object(backup_config, "HASH_FILE", hash_path):
                old_hash = backup_config.compute_combined_hash(
                    src,
                    "/nonexistent/cron.json",
                    "/nonexistent/fastmail-sse-config.json",
                )
                backup_config.save_hash(old_hash)
                # Modify the file
                self._write(src, '{"key": "new"}')
                changed, _ = backup_config.has_changed()
        self.assertTrue(changed)


# ---------------------------------------------------------------------------
# handle_backup
# ---------------------------------------------------------------------------

class TestHandleBackup(unittest.TestCase):
    """handle_backup: check_only mode, missing source, mocked subprocess calls."""

    def test_missing_source_file_returns_error(self):
        with patch("tools.SOURCE_FILE", "/nonexistent/openclaw.json"):
            result = tools.handle_backup({})
        self.assertIn("error", result)

    def test_check_only_unchanged(self):
        with tempfile.NamedTemporaryFile(delete=False) as tf:
            src = tf.name
        try:
            with patch("tools.SOURCE_FILE", src), \
                 patch("tools.has_changed", return_value=(False, "abc" * 21)):
                result = tools.handle_backup({"check_only": True})
        finally:
            os.unlink(src)
        self.assertEqual(result["status"], "unchanged")
        self.assertFalse(result["changed"])

    def test_check_only_changed(self):
        with tempfile.NamedTemporaryFile(delete=False) as tf:
            src = tf.name
        try:
            with patch("tools.SOURCE_FILE", src), \
                 patch("tools.has_changed", return_value=(True, "def" * 21)):
                result = tools.handle_backup({"check_only": True})
        finally:
            os.unlink(src)
        self.assertEqual(result["status"], "changed")
        self.assertTrue(result["changed"])

    def test_no_changes_and_no_workspace_changes_returns_skipped(self):
        with tempfile.NamedTemporaryFile(delete=False) as tf:
            src = tf.name
        try:
            mock_proc = MagicMock()
            mock_proc.stdout = ""
            with patch("tools.SOURCE_FILE", src), \
                 patch("tools.has_changed", return_value=(False, "abc" * 21)), \
                 patch("subprocess.run", return_value=mock_proc):
                result = tools.handle_backup({})
        finally:
            os.unlink(src)
        self.assertEqual(result["status"], "skipped")

    def test_force_flag_skips_change_detection(self):
        with tempfile.NamedTemporaryFile(delete=False) as tf:
            src = tf.name
        try:
            with patch("tools.SOURCE_FILE", src), \
                 patch("tools.has_changed", return_value=(False, "abc" * 21)), \
                 patch("tools.copy_file", return_value=True), \
                 patch("tools.git_commit_push", return_value=True), \
                 patch("tools.save_hash"):
                result = tools.handle_backup({"force": True})
        finally:
            os.unlink(src)
        self.assertEqual(result["status"], "ok")

    def test_copy_failure_returns_error(self):
        with tempfile.NamedTemporaryFile(delete=False) as tf:
            src = tf.name
        try:
            with patch("tools.SOURCE_FILE", src), \
                 patch("tools.has_changed", return_value=(True, "abc" * 21)), \
                 patch("tools.copy_file", return_value=False):
                result = tools.handle_backup({"force": True})
        finally:
            os.unlink(src)
        self.assertIn("error", result)

    def test_git_failure_returns_error(self):
        with tempfile.NamedTemporaryFile(delete=False) as tf:
            src = tf.name
        try:
            with patch("tools.SOURCE_FILE", src), \
                 patch("tools.has_changed", return_value=(True, "abc" * 21)), \
                 patch("tools.copy_file", return_value=True), \
                 patch("tools.git_commit_push", return_value=False):
                result = tools.handle_backup({"force": True})
        finally:
            os.unlink(src)
        self.assertIn("error", result)


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------

class TestManifest(unittest.TestCase):
    """manifest() returns the expected structure."""

    def test_manifest_has_tools(self):
        m = tools.manifest()
        self.assertIn("tools", m)
        self.assertIsInstance(m["tools"], list)
        self.assertGreater(len(m["tools"]), 0)

    def test_manifest_has_config_backup_run(self):
        names = {t["name"] for t in tools.manifest()["tools"]}
        self.assertIn("config_backup_run", names)

    def test_each_tool_has_required_fields(self):
        for tool in tools.manifest()["tools"]:
            self.assertIn("name", tool)
            self.assertIn("description", tool)
            self.assertIn("input_schema", tool)


if __name__ == "__main__":
    unittest.main(verbosity=2)
