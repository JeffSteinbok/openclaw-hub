#!/usr/bin/env python3
"""Workspace path helpers for USPS analysis data."""

from __future__ import annotations

import os
from pathlib import Path


def get_workspace_agent(agent: str | None = None) -> str:
    """Resolve which agent workspace owns USPS data."""
    if not agent:
        raise ValueError("workspace_agent must be specified explicitly")
    return agent


def get_workspace_root(agent: str | None = None) -> Path:
    return Path(os.path.expanduser(f"~/.openclaw/agents/{get_workspace_agent(agent)}/workspace"))


def get_memory_dir(agent: str | None = None) -> Path:
    return get_workspace_root(agent) / "memory"


def get_long_term_memory_dir(agent: str | None = None) -> Path:
    return get_workspace_root(agent) / "memory" / "mail"


def get_usps_dir(agent: str | None = None) -> Path:
    return get_workspace_root(agent) / "usps-mail"


def get_analysis_file(agent: str | None = None) -> Path:
    return get_memory_dir(agent) / "usps_analysis.json"


def get_state_file(agent: str | None = None) -> Path:
    return get_memory_dir(agent) / "usps_state.json"


def get_rules_file(agent: str | None = None) -> Path:
    return get_usps_dir(agent) / "rules.json"


def get_config_file(agent: str | None = None) -> Path:
    return get_usps_dir(agent) / "config.json"
