import json
import tempfile
import unittest
from pathlib import Path

from scripts import build_docs_satellite


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


class BuildDocsSatelliteTests(unittest.TestCase):
    def test_build_docs_satellite_writes_manifest_and_component_chunks(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            release_manifest = root / "release-manifest.json"
            plugins_dir = root / "plugins"
            services_dir = root / "services"
            libs_dir = root / "libs" / "python"
            out_dir = root / "out" / "docs-satellite"

            _write(
                release_manifest,
                json.dumps({"includes": {"plugins": ["demo"], "services": ["fastmail-sse"], "sharedPython": ["repo_paths"]}}),
            )
            _write(
                plugins_dir / "demo" / "openclaw.plugin.json",
                json.dumps(
                    {
                        "id": "demo",
                        "name": "Demo Plugin",
                        "description": "Demo summary.",
                        "setup": {
                            "providers": [
                                {
                                    "id": "demo",
                                    "envVars": ["DEMO_API_KEY"],
                                }
                            ]
                        },
                    }
                ),
            )
            _write(
                plugins_dir / "demo" / "src" / "tools.py",
                'TOOLS = {"demo_tool": {"description": "Demo tool", "input_schema": {"type": "object"}}}\n',
            )
            _write(
                plugins_dir / "demo" / "README.md",
                "# Demo Plugin\n\nDemo summary.\n\n## Configuration\n\n```json\n{\"demo\": true}\n```\n\n## Environment Variables\n\n| Variable | Description |\n|----------|-------------|\n| `DEMO_API_KEY` | Demo API key |\n",
            )
            _write(
                services_dir / "fastmail-sse" / "README.md",
                "# FastMail SSE Service\n\nRealtime adapter.\n\n## Features\n- Watches mail\n",
            )
            _write(
                libs_dir / "README.md",
                "# Shared Python libs\n\nShared runtime packages.\n\n## Dependency direction\n- plugins may import libs\n",
            )
            _write(
                libs_dir / "repo_paths" / "__init__.py",
                '__all__ = ["bootstrap_repo_paths"]\n',
            )
            _write(
                libs_dir / "repo_paths" / "README.md",
                "# repo_paths\n\nBootstrap helpers.\n",
            )

            old_root = build_docs_satellite.REPO_ROOT
            old_plugins = build_docs_satellite.PLUGINS_DIR
            old_services = build_docs_satellite.SERVICES_DIR
            old_libs = build_docs_satellite.LIBS_DIR
            old_manifest = build_docs_satellite.RELEASE_MANIFEST_PATH
            old_out = build_docs_satellite.OUT_DIR
            build_docs_satellite.REPO_ROOT = root
            build_docs_satellite.PLUGINS_DIR = plugins_dir
            build_docs_satellite.SERVICES_DIR = services_dir
            build_docs_satellite.LIBS_DIR = libs_dir
            build_docs_satellite.RELEASE_MANIFEST_PATH = release_manifest
            build_docs_satellite.OUT_DIR = out_dir
            try:
                manifest = build_docs_satellite.build_docs_satellite(out_dir)
            finally:
                build_docs_satellite.REPO_ROOT = old_root
                build_docs_satellite.PLUGINS_DIR = old_plugins
                build_docs_satellite.SERVICES_DIR = old_services
                build_docs_satellite.LIBS_DIR = old_libs
                build_docs_satellite.RELEASE_MANIFEST_PATH = old_manifest
                build_docs_satellite.OUT_DIR = old_out

            self.assertEqual(
                manifest["artifacts"],
                ["libs.json", "libs/repo_paths.json", "plugins/demo.json", "services.json", "services/fastmail-sse.json"],
            )
            plugin_payload = json.loads((out_dir / "plugins" / "demo.json").read_text(encoding="utf-8"))
            self.assertEqual(plugin_payload["plugin"], "demo")
            self.assertEqual(plugin_payload["name"], "Demo Plugin")
            self.assertEqual(plugin_payload["configuration"], '```json\n{"demo": true}\n```')
            self.assertEqual(
                plugin_payload["env_vars"],
                [{"name": "DEMO_API_KEY", "description": "Demo API key"}],
            )
            self.assertEqual(plugin_payload["tools"][0]["name"], "demo_tool")
            service_payload = json.loads((out_dir / "services" / "fastmail-sse.json").read_text(encoding="utf-8"))
            self.assertEqual(service_payload["service"], "fastmail-sse")
            libs_payload = json.loads((out_dir / "libs.json").read_text(encoding="utf-8"))
            self.assertEqual(libs_payload["libraries"][0]["id"], "repo_paths")

    def test_build_docs_satellite_requires_declared_plugin_env_vars_in_readme(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            release_manifest = root / "release-manifest.json"
            plugins_dir = root / "plugins"
            services_dir = root / "services"
            libs_dir = root / "libs" / "python"
            out_dir = root / "out" / "docs-satellite"

            _write(
                release_manifest,
                json.dumps({"includes": {"plugins": ["demo"], "services": [], "sharedPython": []}}),
            )
            _write(
                plugins_dir / "demo" / "openclaw.plugin.json",
                json.dumps(
                    {
                        "id": "demo",
                        "name": "Demo Plugin",
                        "description": "Demo summary.",
                        "setup": {
                            "providers": [
                                {
                                    "id": "demo",
                                    "envVars": ["DEMO_API_KEY"],
                                }
                            ]
                        },
                    }
                ),
            )
            _write(
                plugins_dir / "demo" / "src" / "tools.py",
                'TOOLS = {"demo_tool": {"description": "Demo tool", "input_schema": {"type": "object"}}}\n',
            )
            _write(
                plugins_dir / "demo" / "README.md",
                "# Demo Plugin\n\nDemo summary.\n\n## Environment Variables\n\n| Variable | Description |\n|----------|-------------|\n| `OTHER_VAR` | Wrong var |\n",
            )
            _write(libs_dir / "README.md", "# Shared Python libs\n\nShared runtime packages.\n")

            old_root = build_docs_satellite.REPO_ROOT
            old_plugins = build_docs_satellite.PLUGINS_DIR
            old_services = build_docs_satellite.SERVICES_DIR
            old_libs = build_docs_satellite.LIBS_DIR
            old_manifest = build_docs_satellite.RELEASE_MANIFEST_PATH
            old_out = build_docs_satellite.OUT_DIR
            build_docs_satellite.REPO_ROOT = root
            build_docs_satellite.PLUGINS_DIR = plugins_dir
            build_docs_satellite.SERVICES_DIR = services_dir
            build_docs_satellite.LIBS_DIR = libs_dir
            build_docs_satellite.RELEASE_MANIFEST_PATH = release_manifest
            build_docs_satellite.OUT_DIR = out_dir
            try:
                with self.assertRaises(ValueError) as ctx:
                    build_docs_satellite.build_docs_satellite(out_dir)
            finally:
                build_docs_satellite.REPO_ROOT = old_root
                build_docs_satellite.PLUGINS_DIR = old_plugins
                build_docs_satellite.SERVICES_DIR = old_services
                build_docs_satellite.LIBS_DIR = old_libs
                build_docs_satellite.RELEASE_MANIFEST_PATH = old_manifest
                build_docs_satellite.OUT_DIR = old_out

            self.assertIn("DEMO_API_KEY", str(ctx.exception))

    def test_build_docs_satellite_only_includes_release_manifest_plugins(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            release_manifest = root / "release-manifest.json"
            plugins_dir = root / "plugins"
            services_dir = root / "services"
            libs_dir = root / "libs" / "python"
            out_dir = root / "out" / "docs-satellite"

            _write(
                release_manifest,
                json.dumps({"includes": {"plugins": ["demo"], "services": ["fastmail-sse"], "sharedPython": ["repo_paths"]}}),
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
            _write(services_dir / "fastmail-sse" / "README.md", "# FastMail SSE Service\n\nRealtime adapter.\n")
            _write(services_dir / "ignored-service" / "README.md", "# Ignored Service\n\nIgnore me.\n")
            _write(libs_dir / "README.md", "# Shared Python libs\n\nShared runtime packages.\n")
            _write(libs_dir / "repo_paths" / "__init__.py", "")
            _write(libs_dir / "repo_paths" / "README.md", "# repo_paths\n\nBootstrap helpers.\n")
            _write(libs_dir / "ignored_pkg" / "__init__.py", "")
            _write(libs_dir / "ignored_pkg" / "README.md", "# ignored\n\nIgnore me.\n")

            old_root = build_docs_satellite.REPO_ROOT
            old_plugins = build_docs_satellite.PLUGINS_DIR
            old_services = build_docs_satellite.SERVICES_DIR
            old_libs = build_docs_satellite.LIBS_DIR
            old_manifest = build_docs_satellite.RELEASE_MANIFEST_PATH
            old_out = build_docs_satellite.OUT_DIR
            build_docs_satellite.REPO_ROOT = root
            build_docs_satellite.PLUGINS_DIR = plugins_dir
            build_docs_satellite.SERVICES_DIR = services_dir
            build_docs_satellite.LIBS_DIR = libs_dir
            build_docs_satellite.RELEASE_MANIFEST_PATH = release_manifest
            build_docs_satellite.OUT_DIR = out_dir
            try:
                build_docs_satellite.build_docs_satellite(out_dir)
            finally:
                build_docs_satellite.REPO_ROOT = old_root
                build_docs_satellite.PLUGINS_DIR = old_plugins
                build_docs_satellite.SERVICES_DIR = old_services
                build_docs_satellite.LIBS_DIR = old_libs
                build_docs_satellite.RELEASE_MANIFEST_PATH = old_manifest
                build_docs_satellite.OUT_DIR = old_out

            self.assertTrue((out_dir / "plugins" / "demo.json").exists())
            self.assertFalse((out_dir / "plugins" / "ignored.json").exists())
            self.assertTrue((out_dir / "services" / "fastmail-sse.json").exists())
            self.assertFalse((out_dir / "services" / "ignored-service.json").exists())
            self.assertTrue((out_dir / "libs" / "repo_paths.json").exists())
            self.assertFalse((out_dir / "libs" / "ignored_pkg.json").exists())
