import json
import tempfile
import unittest
from pathlib import Path

from scripts import build_docs_satellite


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


class BuildDocsSatelliteTests(unittest.TestCase):
    def test_build_docs_satellite_writes_manifest_and_plugin_chunks(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            release_manifest = root / "release-manifest.json"
            plugins_dir = root / "plugins"
            out_dir = root / "out" / "docs-satellite"

            _write(
                release_manifest,
                json.dumps({"includes": {"plugins": ["demo"]}}),
            )
            _write(
                plugins_dir / "demo" / "openclaw.plugin.json",
                json.dumps({"id": "demo", "name": "Demo Plugin", "description": "Demo summary."}),
            )
            _write(
                plugins_dir / "demo" / "src" / "tools.py",
                'TOOLS = {"demo_tool": {"description": "Demo tool", "input_schema": {"type": "object"}}}\n',
            )

            old_root = build_docs_satellite.REPO_ROOT
            old_plugins = build_docs_satellite.PLUGINS_DIR
            old_manifest = build_docs_satellite.RELEASE_MANIFEST_PATH
            old_out = build_docs_satellite.OUT_DIR
            build_docs_satellite.REPO_ROOT = root
            build_docs_satellite.PLUGINS_DIR = plugins_dir
            build_docs_satellite.RELEASE_MANIFEST_PATH = release_manifest
            build_docs_satellite.OUT_DIR = out_dir
            try:
                manifest = build_docs_satellite.build_docs_satellite(out_dir)
            finally:
                build_docs_satellite.REPO_ROOT = old_root
                build_docs_satellite.PLUGINS_DIR = old_plugins
                build_docs_satellite.RELEASE_MANIFEST_PATH = old_manifest
                build_docs_satellite.OUT_DIR = old_out

            self.assertEqual(manifest["artifacts"], ["plugins/demo.json"])
            plugin_payload = json.loads((out_dir / "plugins" / "demo.json").read_text(encoding="utf-8"))
            self.assertEqual(plugin_payload["plugin"], "demo")
            self.assertEqual(plugin_payload["name"], "Demo Plugin")
            self.assertEqual(plugin_payload["tools"][0]["name"], "demo_tool")

    def test_build_docs_satellite_only_includes_release_manifest_plugins(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            release_manifest = root / "release-manifest.json"
            plugins_dir = root / "plugins"
            out_dir = root / "out" / "docs-satellite"

            _write(
                release_manifest,
                json.dumps({"includes": {"plugins": ["demo"]}}),
            )
            _write(
                plugins_dir / "demo" / "openclaw.plugin.json",
                json.dumps({"id": "demo", "name": "Demo Plugin", "description": "Demo summary."}),
            )
            _write(
                plugins_dir / "demo" / "src" / "tools.py",
                'TOOLS = {"demo_tool": {"description": "Demo tool", "input_schema": {"type": "object"}}}\n',
            )
            _write(
                plugins_dir / "ignored" / "openclaw.plugin.json",
                json.dumps({"id": "ignored", "name": "Ignored Plugin", "description": "Ignore me."}),
            )
            _write(
                plugins_dir / "ignored" / "src" / "tools.py",
                'TOOLS = {"ignored_tool": {"description": "Ignored tool", "input_schema": {"type": "object"}}}\n',
            )

            old_root = build_docs_satellite.REPO_ROOT
            old_plugins = build_docs_satellite.PLUGINS_DIR
            old_manifest = build_docs_satellite.RELEASE_MANIFEST_PATH
            old_out = build_docs_satellite.OUT_DIR
            build_docs_satellite.REPO_ROOT = root
            build_docs_satellite.PLUGINS_DIR = plugins_dir
            build_docs_satellite.RELEASE_MANIFEST_PATH = release_manifest
            build_docs_satellite.OUT_DIR = out_dir
            try:
                build_docs_satellite.build_docs_satellite(out_dir)
            finally:
                build_docs_satellite.REPO_ROOT = old_root
                build_docs_satellite.PLUGINS_DIR = old_plugins
                build_docs_satellite.RELEASE_MANIFEST_PATH = old_manifest
                build_docs_satellite.OUT_DIR = old_out

            self.assertTrue((out_dir / "plugins" / "demo.json").exists())
            self.assertFalse((out_dir / "plugins" / "ignored.json").exists())
