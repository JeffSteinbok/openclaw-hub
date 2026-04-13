#!/usr/bin/env python3
"""Plugin dispatch wrapper for the OpenClaw config backup tool."""

import json
import os
import sys

from backup_config import (
    SOURCE_FILE,
    has_changed,
    copy_file,
    git_commit_push,
    save_hash,
)

TOOLS = {
    "config_backup_run": {
        "description": (
            "Back up OpenClaw config and agent workspace to Git. "
            "Copies ~/.openclaw config files into the Git repo, commits, "
            "and pushes only when content has changed (SHA-256 detection)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "force": {
                    "type": "boolean",
                    "description": "Force backup even if no changes detected",
                    "default": False,
                },
                "check_only": {
                    "type": "boolean",
                    "description": "Only check for changes without committing",
                    "default": False,
                },
                "verbose": {
                    "type": "boolean",
                    "description": "Include verbose diagnostic output",
                    "default": False,
                },
            },
            "additionalProperties": False,
        },
        "handler": None,  # assigned below
    }
}


def handle_backup(args):
    force = args.get("force", False)
    check_only = args.get("check_only", False)
    verbose = args.get("verbose", False)

    if not os.path.exists(SOURCE_FILE):
        return {"error": f"{SOURCE_FILE} not found"}

    changed, current_hash = has_changed(verbose=verbose)
    log = []

    if verbose:
        log.append(f"Changed: {changed}, hash: {current_hash[:12]}…")

    if check_only:
        status = "changed" if changed else "unchanged"
        return {"status": status, "changed": changed, "hash": current_hash, "log": log}

    if not changed and not force:
        # Check for agent workspace changes (mirrors CLI behaviour)
        import subprocess

        from backup_config import GIT_REPO

        try:
            os.chdir(GIT_REPO)
            result = subprocess.run(
                ["git", "status", "--porcelain", "agents/"],
                capture_output=True,
                text=True,
            )
            workspace_changed = bool(result.stdout.strip())
        except Exception:
            workspace_changed = False

        if not workspace_changed:
            return {
                "status": "skipped",
                "changed": False,
                "message": "No changes detected",
                "log": log,
            }
        else:
            log.append("Config unchanged but agent workspace has changes")

    if not copy_file(verbose=verbose):
        return {"error": "Failed to copy config files", "log": log}
    log.append("Copied config files")

    if not git_commit_push(verbose=verbose):
        return {"error": "Git commit/push failed", "log": log}
    log.append("Committed and pushed")

    save_hash(current_hash)
    log.append("Hash saved")

    return {"status": "ok", "changed": changed, "hash": current_hash, "log": log}


TOOLS["config_backup_run"]["handler"] = handle_backup


# ── dispatch ────────────────────────────────────────────────────────────────

def manifest():
    return {
        "tools": [
            {
                "name": name,
                "description": t["description"],
                "input_schema": t["input_schema"],
            }
            for name, t in TOOLS.items()
        ]
    }


def call(tool, args):
    return TOOLS[tool]["handler"](args)


def main():
    payload = json.load(sys.stdin)
    if payload["method"] == "manifest":
        print(json.dumps(manifest()))
    elif payload["method"] == "call":
        print(json.dumps(call(payload["tool"], payload["args"])))


if __name__ == "__main__":
    main()
