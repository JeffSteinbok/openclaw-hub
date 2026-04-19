import os
import tempfile
import unittest
from pathlib import Path

from scripts.export_artifacts import export_plugin, export_service


def _write(path: Path, content: str = "") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


class ExportArtifactsTests(unittest.TestCase):
    def test_export_plugin_dereferences_dist_python_and_vendors_dependency_closure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            plugin = root / "plugins" / "demo"
            dist = plugin / "dist"
            src = plugin / "src"
            libs = root / "libs" / "python"
            output = root / "out"

            _write(plugin / "package.json", '{"name":"demo"}\n')
            _write(plugin / "openclaw.plugin.json", '{"id":"demo"}\n')
            _write(dist / "index.js", "export default {};\n")
            _write(src / "tools.py", "from repo_paths.bootstrap import bootstrap_repo_paths\nimport shared_a\n")
            dist.mkdir(parents=True, exist_ok=True)
            os.symlink(src / "tools.py", dist / "tools.py")

            _write(libs / "repo_paths" / "__init__.py")
            _write(libs / "repo_paths" / "bootstrap.py")
            _write(libs / "shared_a" / "__init__.py", "import shared_b\n")
            _write(libs / "shared_b" / "__init__.py")
            _write(libs / "unused_pkg" / "__init__.py")

            artifact = export_plugin("demo", output, plugins_dir=root / "plugins", libs_dir=libs)

            exported_tools = artifact.output_dir / "dist" / "tools.py"
            self.assertTrue(exported_tools.is_file())
            self.assertFalse(exported_tools.is_symlink())
            self.assertEqual(
                artifact.vendored_packages,
                ["repo_paths", "shared_a", "shared_b"],
            )
            self.assertTrue((artifact.output_dir / "python" / "repo_paths" / "bootstrap.py").is_file())
            self.assertTrue((artifact.output_dir / "python" / "shared_a" / "__init__.py").is_file())
            self.assertTrue((artifact.output_dir / "python" / "shared_b" / "__init__.py").is_file())
            self.assertFalse((artifact.output_dir / "python" / "unused_pkg").exists())

    def test_export_service_copies_runtime_files_and_vendors_only_needed_libs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            service = root / "services" / "demo-service"
            libs = root / "libs" / "python"
            output = root / "out"

            _write(service / "run.py", "from repo_paths.bootstrap import bootstrap_repo_paths\nimport shared_svc\n")
            _write(service / "README.md", "# demo\n")
            _write(service / "tests" / "test_run.py", "raise RuntimeError('should not copy')\n")
            _write(libs / "repo_paths" / "__init__.py")
            _write(libs / "repo_paths" / "bootstrap.py")
            _write(libs / "shared_svc" / "__init__.py")
            _write(libs / "unused_pkg" / "__init__.py")

            artifact = export_service("demo-service", output, services_dir=root / "services", libs_dir=libs)

            self.assertTrue((artifact.output_dir / "run.py").is_file())
            self.assertTrue((artifact.output_dir / "README.md").is_file())
            self.assertFalse((artifact.output_dir / "tests").exists())
            self.assertEqual(artifact.vendored_packages, ["repo_paths", "shared_svc"])
            self.assertTrue((artifact.output_dir / "python" / "repo_paths" / "bootstrap.py").is_file())
            self.assertTrue((artifact.output_dir / "python" / "shared_svc" / "__init__.py").is_file())
            self.assertFalse((artifact.output_dir / "python" / "unused_pkg").exists())


if __name__ == "__main__":
    unittest.main()
