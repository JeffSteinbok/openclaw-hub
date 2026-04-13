#!/usr/bin/env python3
"""Compatibility wrapper for the shared package-tracking core."""

from __future__ import annotations

import sys
from pathlib import Path


def _bootstrap_python_libs() -> None:
    anchor = Path(__file__).resolve()
    for base in anchor.parents:
        vendored_dir = base / "python"
        if vendored_dir.is_dir():
            vendored_str = str(vendored_dir)
            if vendored_str not in sys.path:
                sys.path.insert(0, vendored_str)
            return
    for base in anchor.parents:
        libs_dir = base / "libs" / "python"
        if libs_dir.is_dir() and (base / "package.json").is_file():
            libs_str = str(libs_dir)
            if libs_str not in sys.path:
                sys.path.insert(0, libs_str)
            return


_bootstrap_python_libs()

from repo_paths.bootstrap import bootstrap_repo_paths

BOOTSTRAP_PATHS = bootstrap_repo_paths(__file__)

import package_tracking_core

from package_tracking_core import *  # noqa: F401,F403
