"""Tests for bootstrap.py shared Python path helpers."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from bootstrap import (
    BootstrapPaths,
    _find_repo_root,
    _find_vendored_python,
    _prepend_paths,
    bootstrap_repo_paths,
)


class TestFindVendoredPython(unittest.TestCase):
    """Tests for _find_vendored_python."""

    def test_finds_python_dir_in_parent(self):
        with tempfile.TemporaryDirectory() as tmp:
            python_dir = Path(tmp) / "python"
            python_dir.mkdir()
            anchor = Path(tmp) / "sub" / "deep"
            anchor.mkdir(parents=True)
            result = _find_vendored_python(anchor)
            self.assertEqual(result, python_dir)

    def test_finds_python_dir_as_immediate_sibling(self):
        with tempfile.TemporaryDirectory() as tmp:
            python_dir = Path(tmp) / "python"
            python_dir.mkdir()
            anchor = Path(tmp) / "other"
            anchor.mkdir()
            result = _find_vendored_python(anchor)
            self.assertEqual(result, python_dir)

    def test_returns_none_when_no_python_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            anchor = Path(tmp) / "sub" / "deep"
            anchor.mkdir(parents=True)
            result = _find_vendored_python(anchor)
            self.assertIsNone(result)

    def test_ignores_python_file_not_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "python").touch()  # file, not dir
            anchor = Path(tmp) / "child"
            anchor.mkdir()
            result = _find_vendored_python(anchor)
            self.assertIsNone(result)


class TestFindRepoRoot(unittest.TestCase):
    """Tests for _find_repo_root."""

    def _make_repo(self, base: Path) -> Path:
        (base / "package.json").touch()
        (base / "plugins").mkdir()
        (base / "services").mkdir()
        return base

    def test_finds_repo_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            root.mkdir()
            self._make_repo(root)
            anchor = root / "plugins" / "myplugin"
            anchor.mkdir(parents=True)
            result = _find_repo_root(anchor)
            self.assertEqual(result, root)

    def test_returns_none_when_missing_package_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            root.mkdir()
            (root / "plugins").mkdir()
            (root / "services").mkdir()
            # no package.json
            anchor = root / "plugins" / "myplugin"
            anchor.mkdir(parents=True)
            result = _find_repo_root(anchor)
            self.assertIsNone(result)

    def test_returns_none_when_missing_plugins_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            root.mkdir()
            (root / "package.json").touch()
            (root / "services").mkdir()
            anchor = root / "child"
            anchor.mkdir()
            result = _find_repo_root(anchor)
            self.assertIsNone(result)

    def test_returns_none_when_missing_services_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            root.mkdir()
            (root / "package.json").touch()
            (root / "plugins").mkdir()
            anchor = root / "child"
            anchor.mkdir()
            result = _find_repo_root(anchor)
            self.assertIsNone(result)

    def test_returns_none_when_no_markers_anywhere(self):
        with tempfile.TemporaryDirectory() as tmp:
            anchor = Path(tmp) / "a" / "b"
            anchor.mkdir(parents=True)
            result = _find_repo_root(anchor)
            self.assertIsNone(result)


class TestPrependPaths(unittest.TestCase):
    """Tests for _prepend_paths."""

    def setUp(self):
        self._original_sys_path = sys.path[:]

    def tearDown(self):
        sys.path[:] = self._original_sys_path

    def test_prepends_in_order(self):
        p1 = Path("/fake/path_one")
        p2 = Path("/fake/path_two")
        _prepend_paths([p1, p2])
        self.assertEqual(sys.path[0], str(p1))
        self.assertEqual(sys.path[1], str(p2))

    def test_deduplicates(self):
        p = Path("/fake/dup_path")
        _prepend_paths([p, p, p])
        count = sys.path.count(str(p))
        self.assertEqual(count, 1)

    def test_moves_existing_path_to_front(self):
        sentinel = "/fake/existing_sentinel"
        sys.path.append(sentinel)
        _prepend_paths([Path(sentinel)])
        self.assertEqual(sys.path[0], sentinel)
        self.assertEqual(sys.path.count(sentinel), 1)

    def test_empty_list_is_noop(self):
        before = sys.path[:]
        _prepend_paths([])
        self.assertEqual(sys.path, before)


class TestBootstrapRepoPaths(unittest.TestCase):
    """Tests for bootstrap_repo_paths."""

    def setUp(self):
        self._original_sys_path = sys.path[:]

    def tearDown(self):
        sys.path[:] = self._original_sys_path

    def _make_full_repo(self, root: Path) -> None:
        """Create a repo with package.json, plugins/, services/, libs/python/."""
        (root / "package.json").touch()
        (root / "plugins").mkdir()
        (root / "services").mkdir()
        (root / "libs" / "python").mkdir(parents=True)

    def test_happy_path_vendored_and_repo(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            self._make_full_repo(root)
            plugin = root / "plugins" / "myplugin"
            plugin.mkdir(parents=True)
            python_dir = plugin / "python"
            python_dir.mkdir()
            # anchor must be inside plugin so python/ is found in parent search
            anchor = plugin / "src"
            anchor.mkdir()

            result = bootstrap_repo_paths(anchor)

            self.assertEqual(result.anchor, anchor)
            self.assertEqual(result.vendored_dir, python_dir)
            self.assertEqual(result.repo_root, root)
            self.assertEqual(result.libs_dir, root / "libs" / "python")
            self.assertEqual(result.legacy_dirs, ())
            # sys.path should start with vendored then libs
            self.assertEqual(sys.path[0], str(python_dir))
            self.assertEqual(sys.path[1], str(root / "libs" / "python"))

    def test_vendored_only_no_repo_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp).resolve() / "isolated"
            base.mkdir()
            python_dir = base / "python"
            python_dir.mkdir()
            anchor = base / "app"
            anchor.mkdir()

            result = bootstrap_repo_paths(anchor)

            self.assertEqual(result.vendored_dir, python_dir)
            self.assertIsNone(result.repo_root)
            self.assertIsNone(result.libs_dir)
            self.assertIn(str(python_dir), sys.path)

    def test_legacy_subdirs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            self._make_full_repo(root)
            legacy = root / "old_shared"
            legacy.mkdir()
            plugin = root / "plugins" / "p1"
            plugin.mkdir(parents=True)
            python_dir = plugin / "python"
            python_dir.mkdir()

            result = bootstrap_repo_paths(plugin, legacy_subdirs=("old_shared",))

            self.assertEqual(result.legacy_dirs, (legacy,))
            self.assertIn(str(legacy), sys.path)

    def test_legacy_subdirs_missing_are_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            self._make_full_repo(root)
            plugin = root / "plugins" / "p1"
            plugin.mkdir(parents=True)
            python_dir = plugin / "python"
            python_dir.mkdir()

            result = bootstrap_repo_paths(plugin, legacy_subdirs=("nonexistent",))

            self.assertEqual(result.legacy_dirs, ())

    def test_raises_when_no_paths_found(self):
        with tempfile.TemporaryDirectory() as tmp:
            anchor = Path(tmp) / "nowhere"
            anchor.mkdir()
            with self.assertRaises(RuntimeError) as ctx:
                bootstrap_repo_paths(anchor)
            self.assertIn("Could not locate shared Python paths", str(ctx.exception))

    def test_accepts_string_anchor(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp).resolve() / "proj"
            base.mkdir()
            (base / "python").mkdir()
            anchor = base / "entry"
            anchor.mkdir()

            result = bootstrap_repo_paths(str(anchor))
            self.assertIsInstance(result.anchor, Path)

    def test_libs_dir_none_when_dir_missing(self):
        """libs_dir should be None when libs/python/ doesn't exist on disk."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            (root / "package.json").touch()
            (root / "plugins").mkdir()
            (root / "services").mkdir()
            # deliberately do NOT create libs/python/
            # place python/ at plugins level so _find_vendored_python finds it
            python_dir = root / "plugins" / "python"
            python_dir.mkdir()
            plugin = root / "plugins" / "p"
            plugin.mkdir(parents=True)

            result = bootstrap_repo_paths(plugin)

            self.assertEqual(result.repo_root, root)
            self.assertIsNone(result.libs_dir)


class TestBootstrapPathsDataclass(unittest.TestCase):
    """Tests for the BootstrapPaths dataclass."""

    def test_fields(self):
        bp = BootstrapPaths(
            anchor=Path("/a"),
            vendored_dir=Path("/v"),
            repo_root=Path("/r"),
            libs_dir=Path("/l"),
            legacy_dirs=(Path("/d1"), Path("/d2")),
        )
        self.assertEqual(bp.anchor, Path("/a"))
        self.assertEqual(bp.vendored_dir, Path("/v"))
        self.assertEqual(bp.repo_root, Path("/r"))
        self.assertEqual(bp.libs_dir, Path("/l"))
        self.assertEqual(bp.legacy_dirs, (Path("/d1"), Path("/d2")))

    def test_none_fields(self):
        bp = BootstrapPaths(
            anchor=Path("/a"),
            vendored_dir=None,
            repo_root=None,
            libs_dir=None,
            legacy_dirs=(),
        )
        self.assertIsNone(bp.vendored_dir)
        self.assertIsNone(bp.repo_root)
        self.assertIsNone(bp.libs_dir)
        self.assertEqual(bp.legacy_dirs, ())

    def test_frozen(self):
        bp = BootstrapPaths(
            anchor=Path("/a"),
            vendored_dir=None,
            repo_root=None,
            libs_dir=None,
            legacy_dirs=(),
        )
        with self.assertRaises(AttributeError):
            bp.anchor = Path("/other")


if __name__ == "__main__":
    unittest.main()
