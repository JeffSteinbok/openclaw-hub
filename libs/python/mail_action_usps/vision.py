#!/usr/bin/env python3
"""
Vision analysis backends for USPS mailpiece scans.

Two backends:
  - openclaw_agent: copies image to agent workspace, asks openclaw agent to analyze
  - provided: analysis is passed directly (for Copilot inline / testing)

The backend is selected automatically: if analysis is supplied to the pipeline,
"provided" is used. Otherwise "openclaw_agent" is used.
"""

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

# Load the analysis prompt from the sibling markdown file
_PROMPT_PATH = Path(__file__).parent / "analyze_prompt.md"
_ANALYSIS_PROMPT = ""
if _PROMPT_PATH.exists():
    _ANALYSIS_PROMPT = _PROMPT_PATH.read_text()


def _build_agent_prompt(staging_name: str) -> str:
    """Build the prompt sent to openclaw agent for a single image."""
    return (
        f"View the image at camera_captures/{staging_name} and analyze it.\n\n"
        f"{_ANALYSIS_PROMPT}\n\n"
        "Return ONLY the JSON object, no markdown fences, no explanation."
    )


def _get_agent_media_dir(agent: str) -> str:
    if not agent:
        raise ValueError("vision_agent is required")
    return os.path.expanduser(f"~/.openclaw/agents/{agent}/workspace/camera_captures")


def analyze_via_agent(image_path: str, vision_agent: str) -> dict:
    """Analyze a single mailpiece scan via openclaw agent vision."""
    agent_media_dir = _get_agent_media_dir(vision_agent)
    os.makedirs(agent_media_dir, exist_ok=True)

    src = Path(image_path)
    staging_name = f"usps-scan-{src.name}"
    staging_path = Path(agent_media_dir) / staging_name

    try:
        shutil.copy2(str(src), str(staging_path))
        prompt = _build_agent_prompt(staging_name)

        result = subprocess.run(
            [
                "openclaw", "agent", "--agent", vision_agent, "--json",
                "--timeout", "90", "--message", prompt,
            ],
            capture_output=True, text=True, timeout=120,
        )

        if result.returncode != 0:
            raise RuntimeError(f"openclaw agent failed: {result.stderr[:200]}")

        data = json.loads(result.stdout)
        text = data["result"]["payloads"][0]["text"]

        # Strip markdown fences if present
        text = re.sub(r"^```(?:json)?\s*", "", text.strip())
        text = re.sub(r"\s*```$", "", text.strip())
        return json.loads(text)

    finally:
        if staging_path.exists():
            staging_path.unlink()


def validate_analysis(analysis: dict) -> dict:
    """Ensure an analysis dict has all required fields with defaults."""
    return {
        "sender": analysis.get("sender", "Unknown"),
        "addressee": analysis.get("addressee", "Unknown"),
        "description": analysis.get("description", ""),
        "type": analysis.get("type", "scan"),
        "importance": analysis.get("importance", "medium"),
        "mail_class": analysis.get("mail_class", "Unknown"),
        "address_method": analysis.get("address_method", ""),
    }
