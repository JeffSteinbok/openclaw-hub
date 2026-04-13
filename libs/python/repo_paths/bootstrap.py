"""Bootstrap helpers for shared Python imports."""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class BootstrapPaths:
    """Resolved Python path layout for a plugin/service entrypoint."""

    anchor: Path
    vendored_dir: Path | None
    repo_root: Path | None
    libs_dir: Path | None
    legacy_dirs: tuple[Path, ...]


def _iter_bases(anchor: Path):
    yield from anchor.parents


def _find_vendored_python(anchor: Path) -> Path | None:
    for base in _iter_bases(anchor):
        candidate = base / "python"
        if candidate.is_dir():
            return candidate
    return None


def _find_repo_root(anchor: Path) -> Path | None:
    for base in _iter_bases(anchor):
        if (
            (base / "package.json").is_file()
            and (base / "plugins").is_dir()
            and (base / "services").is_dir()
        ):
            return base
    return None


def _prepend_paths(paths: list[Path]) -> None:
    unique_paths: list[Path] = []
    seen: set[str] = set()
    for path in paths:
        path_str = str(path)
        if path_str in seen:
            continue
        seen.add(path_str)
        unique_paths.append(path)

    for path in reversed(unique_paths):
        path_str = str(path)
        if path_str in sys.path:
            sys.path.remove(path_str)
        sys.path.insert(0, path_str)


def bootstrap_repo_paths(anchor: str | Path, *, legacy_subdirs: tuple[str, ...] = ()) -> BootstrapPaths:
    """Add vendored/repo Python shared paths to `sys.path` in priority order."""

    anchor_path = Path(anchor).resolve()
    vendored_dir = _find_vendored_python(anchor_path)
    repo_root = _find_repo_root(anchor_path)
    libs_dir = repo_root / "libs" / "python" if repo_root else None

    ordered_paths: list[Path] = []
    if vendored_dir:
        ordered_paths.append(vendored_dir)
    if libs_dir and libs_dir.is_dir() and libs_dir != vendored_dir:
        ordered_paths.append(libs_dir)

    legacy_dirs: list[Path] = []
    if repo_root:
        for subdir in legacy_subdirs:
            legacy_dir = repo_root / subdir
            if legacy_dir.is_dir():
                legacy_dirs.append(legacy_dir)
                ordered_paths.append(legacy_dir)

    if not ordered_paths:
        raise RuntimeError(
            f"Could not locate shared Python paths for {anchor_path}. "
            "Expected a vendored python/ directory or repo libs/python/."
        )

    _prepend_paths(ordered_paths)
    return BootstrapPaths(
        anchor=anchor_path,
        vendored_dir=vendored_dir,
        repo_root=repo_root,
        libs_dir=libs_dir if libs_dir and libs_dir.is_dir() else None,
        legacy_dirs=tuple(legacy_dirs),
    )
