#!/usr/bin/env python3
"""Export self-contained plugin and service artifacts with vendored Python libs."""

from __future__ import annotations

import argparse
import ast
import json
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
PLUGINS_DIR = REPO_ROOT / "plugins"
SERVICES_DIR = REPO_ROOT / "services"
LIBS_DIR = REPO_ROOT / "libs" / "python"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "out" / "export"


def _ignore_names(path: str, names: list[str]) -> set[str]:
    ignored = {"__pycache__", ".pytest_cache", "tests", "node_modules"}
    if Path(path).name == "src":
        ignored.add("__pycache__")
    return {name for name in names if name in ignored}


def _list_shared_packages(libs_dir: Path) -> set[str]:
    return {
        entry.name
        for entry in libs_dir.iterdir()
        if entry.is_dir() and (entry / "__init__.py").is_file()
    }


def _iter_python_files(root: Path) -> list[Path]:
    return sorted(
        path
        for path in root.rglob("*.py")
        if "__pycache__" not in path.parts and ".pytest_cache" not in path.parts and "tests" not in path.parts
    )


def _parse_import_roots(path: Path, known_packages: set[str]) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    imports: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".", 1)[0]
                if root in known_packages:
                    imports.add(root)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            root = node.module.split(".", 1)[0]
            if root in known_packages:
                imports.add(root)
    return imports


def _build_shared_dependency_graph(libs_dir: Path) -> dict[str, set[str]]:
    known_packages = _list_shared_packages(libs_dir)
    graph: dict[str, set[str]] = {package: set() for package in known_packages}
    for package in known_packages:
        package_dir = libs_dir / package
        for path in _iter_python_files(package_dir):
            graph[package].update(_parse_import_roots(path, known_packages))
        graph[package].discard(package)
    return graph


def _resolve_required_shared_packages(entry_files: list[Path], libs_dir: Path) -> list[str]:
    graph = _build_shared_dependency_graph(libs_dir)
    known_packages = set(graph)
    pending: list[str] = []
    required: set[str] = set()

    for path in entry_files:
        pending.extend(sorted(_parse_import_roots(path, known_packages)))

    while pending:
        package = pending.pop()
        if package in required:
            continue
        required.add(package)
        pending.extend(sorted(graph[package] - required))

    return sorted(required)


def _reset_dir(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)
    path.mkdir(parents=True, exist_ok=True)


def _copy_tree(src: Path, dest: Path) -> None:
    shutil.copytree(src, dest, symlinks=False, ignore=_ignore_names, dirs_exist_ok=True)


def _copy_if_exists(src: Path, dest: Path) -> None:
    if src.is_file():
        shutil.copy2(src, dest)


def _vendor_shared_packages(dest_dir: Path, required_packages: list[str], libs_dir: Path) -> None:
    if not required_packages:
        return

    python_dir = dest_dir / "python"
    python_dir.mkdir(parents=True, exist_ok=True)
    for package in required_packages:
        _copy_tree(libs_dir / package, python_dir / package)


@dataclass(frozen=True)
class ExportedArtifact:
    kind: str
    name: str
    output_dir: Path
    vendored_packages: list[str]

    def to_json(self, output_root: Path) -> dict[str, object]:
        return {
            "kind": self.kind,
            "name": self.name,
            "output": self.output_dir.relative_to(output_root).as_posix(),
            "vendored_python": self.vendored_packages,
        }


def export_plugin(name: str, output_dir: Path, *, plugins_dir: Path = PLUGINS_DIR, libs_dir: Path = LIBS_DIR) -> ExportedArtifact:
    plugin_dir = plugins_dir / name
    if not plugin_dir.is_dir():
        raise FileNotFoundError(f"Unknown plugin: {name}")

    dist_dir = plugin_dir / "dist"
    if not dist_dir.is_dir():
        raise RuntimeError(f"Plugin {name} is not built. Run npm run build first.")

    dest_dir = output_dir / "plugins" / name
    _reset_dir(dest_dir)

    for filename in ("package.json", "package-lock.json", "openclaw.plugin.json", "README.md"):
        _copy_if_exists(plugin_dir / filename, dest_dir / filename)

    _copy_tree(dist_dir, dest_dir / "dist")

    vendored_packages = _resolve_required_shared_packages(
        _iter_python_files(dest_dir / "dist"),
        libs_dir,
    )
    _vendor_shared_packages(dest_dir, vendored_packages, libs_dir)

    return ExportedArtifact(kind="plugin", name=name, output_dir=dest_dir, vendored_packages=vendored_packages)


def export_service(name: str, output_dir: Path, *, services_dir: Path = SERVICES_DIR, libs_dir: Path = LIBS_DIR) -> ExportedArtifact:
    service_dir = services_dir / name
    if not service_dir.is_dir():
        raise FileNotFoundError(f"Unknown service: {name}")

    dest_dir = output_dir / "services" / name
    _reset_dir(dest_dir)
    _copy_tree(service_dir, dest_dir)

    vendored_packages = _resolve_required_shared_packages(
        _iter_python_files(dest_dir),
        libs_dir,
    )
    _vendor_shared_packages(dest_dir, vendored_packages, libs_dir)

    return ExportedArtifact(kind="service", name=name, output_dir=dest_dir, vendored_packages=vendored_packages)


def _list_exportable_plugins(plugins_dir: Path) -> list[str]:
    names: list[str] = []
    for entry in sorted(plugins_dir.iterdir()):
        if not entry.is_dir():
            continue
        if (entry / "openclaw.plugin.json").is_file() and (entry / "dist" / "index.js").is_file():
            names.append(entry.name)
    return names


def _list_exportable_services(services_dir: Path) -> list[str]:
    return sorted(entry.name for entry in services_dir.iterdir() if entry.is_dir())


def _write_manifest(output_dir: Path, artifacts: list[ExportedArtifact]) -> None:
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "artifacts": [artifact.to_json(output_dir) for artifact in artifacts],
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plugin", action="append", default=[], help="Plugin name to export (repeatable)")
    parser.add_argument("--service", action="append", default=[], help="Service name to export (repeatable)")
    parser.add_argument("--all-plugins", action="store_true", help="Export every built plugin")
    parser.add_argument("--all-services", action="store_true", help="Export every service")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Destination directory for exported artifacts (default: {DEFAULT_OUTPUT_DIR})",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    plugin_names = list(dict.fromkeys(args.plugin))
    service_names = list(dict.fromkeys(args.service))

    if args.all_plugins:
        plugin_names.extend(name for name in _list_exportable_plugins(PLUGINS_DIR) if name not in plugin_names)
    if args.all_services:
        service_names.extend(name for name in _list_exportable_services(SERVICES_DIR) if name not in service_names)

    if not plugin_names and not service_names:
        raise SystemExit("Choose at least one export target via --plugin/--service or --all-plugins/--all-services.")

    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    artifacts: list[ExportedArtifact] = []
    for name in plugin_names:
        artifacts.append(export_plugin(name, output_dir))
    for name in service_names:
        artifacts.append(export_service(name, output_dir))

    _write_manifest(output_dir, artifacts)
    print(json.dumps({"output_dir": str(output_dir), "artifacts": [artifact.to_json(output_dir) for artifact in artifacts]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
