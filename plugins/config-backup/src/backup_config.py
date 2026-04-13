#!/usr/bin/env python3
"""
Backup OpenClaw config to Git with automatic change detection.

Copies ~/.openclaw/openclaw.json and cron/jobs.json into a local Git repo
(~/git/openclaw/config/), then commits and pushes only when content has
actually changed (tracked via a persisted SHA-256 hash).

Usage:
    backup_config.py [--force] [--verbose] [--check-only]
"""

import os
import sys
import hashlib
import subprocess
import shutil
import argparse
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths — source files live under ~/.openclaw, destination is a Git work-tree
# ---------------------------------------------------------------------------
SOURCE_FILE = os.path.expanduser("~/.openclaw/openclaw.json")
CRON_FILE = os.path.expanduser("~/.openclaw/cron/jobs.json")
FASTMAIL_SSE_CONFIG_FILE = os.path.expanduser("~/.openclaw/services/fastmail-sse-config.json")
DEST_DIR = os.path.expanduser("~/git/openclaw/config")
DEST_FILE = os.path.join(DEST_DIR, "openclaw.json")
CRON_DEST_FILE = os.path.join(DEST_DIR, "jobs.json")
FASTMAIL_SSE_CONFIG_DEST_FILE = os.path.join(DEST_DIR, "fastmail-sse-config.json")
# Git repo root — used for committing agent workspace changes (memory, etc.)
GIT_REPO = os.path.expanduser("~/git/openclaw")
# Stores the hash of the last successfully committed content
HASH_FILE = os.path.expanduser("~/.openclaw/.config_backup_hash")

# ---------------------------------------------------------------------------
# Hashing helpers — used to detect whether config content has changed
# ---------------------------------------------------------------------------

def compute_combined_hash(*filepaths):
    """Compute a single SHA-256 digest over the concatenated content of all files."""
    sha256 = hashlib.sha256()
    for filepath in filepaths:
        try:
            with open(filepath, 'rb') as f:
                # Stream in 4 KiB chunks to keep memory usage low on large files
                for chunk in iter(lambda: f.read(4096), b''):
                    sha256.update(chunk)
        except FileNotFoundError:
            # Missing files are silently skipped — their absence is part of the hash
            pass
        except Exception as e:
            print(f"Error reading {filepath}: {e}", file=sys.stderr)
            sys.exit(1)
    return sha256.hexdigest()

def get_last_hash():
    """Read the hash saved after the last successful backup (or None if unavailable)."""
    if os.path.exists(HASH_FILE):
        try:
            with open(HASH_FILE, 'r') as f:
                return f.read().strip()
        except:
            # Corrupt or unreadable file — treat as "no prior hash"
            return None
    return None

def save_hash(hash_value):
    """Persist the current hash so the next run can detect changes."""
    try:
        with open(HASH_FILE, 'w') as f:
            f.write(hash_value)
    except Exception as e:
        print(f"Warning: Could not save hash: {e}", file=sys.stderr)

# ---------------------------------------------------------------------------
# Change detection
# ---------------------------------------------------------------------------

def has_changed(verbose=False):
    """Check if config or cron files differ from the last committed state.

    Returns a (changed: bool, current_hash: str) tuple.
    """
    current_hash = compute_combined_hash(SOURCE_FILE, CRON_FILE, FASTMAIL_SSE_CONFIG_FILE)
    last_hash = get_last_hash()
    
    if verbose:
        print(f"Current hash: {current_hash[:8]}...")
        print(f"Last commit hash: {last_hash[:8] if last_hash else 'None'}...")
    
    return current_hash != last_hash, current_hash

# ---------------------------------------------------------------------------
# File copy
# ---------------------------------------------------------------------------

def copy_file(verbose=False):
    """Copy the config and (optional) cron file into the Git-tracked directory."""
    try:
        os.makedirs(DEST_DIR, exist_ok=True)
        shutil.copy2(SOURCE_FILE, DEST_FILE)
        if verbose:
            print(f"Copied {SOURCE_FILE} to {DEST_FILE}")
        if os.path.exists(CRON_FILE):
            shutil.copy2(CRON_FILE, CRON_DEST_FILE)
            if verbose:
                print(f"Copied {CRON_FILE} to {CRON_DEST_FILE}")
        if os.path.exists(FASTMAIL_SSE_CONFIG_FILE):
            shutil.copy2(FASTMAIL_SSE_CONFIG_FILE, FASTMAIL_SSE_CONFIG_DEST_FILE)
            if verbose:
                print(f"Copied {FASTMAIL_SSE_CONFIG_FILE} to {FASTMAIL_SSE_CONFIG_DEST_FILE}")
        return True
    except Exception as e:
        print(f"Error copying file: {e}", file=sys.stderr)
        return False

# ---------------------------------------------------------------------------
# Git operations
# ---------------------------------------------------------------------------

def git_commit_push(verbose=False):
    """Stage config, agent workspace changes (memory, etc.), commit, and push."""
    try:
        os.chdir(GIT_REPO)

        # Stage config files
        config_paths = ["config/openclaw.json", "config/jobs.json"]
        if os.path.exists(FASTMAIL_SSE_CONFIG_DEST_FILE):
            config_paths.append("config/fastmail-sse-config.json")
        subprocess.run(
            ["git", "add", *config_paths],
            check=True, capture_output=True
        )
        if verbose:
            print("Staged config files")

        # Stage agent workspace changes (memory files, TOOLS.md, SOUL.md, etc.)
        subprocess.run(
            ["git", "add", "agents/"],
            check=True, capture_output=True
        )
        if verbose:
            print("Staged agent workspace changes")

        # Check if there's anything to commit
        result = subprocess.run(
            ["git", "diff", "--cached", "--quiet"],
            capture_output=True
        )
        has_staged = result.returncode != 0

        if has_staged:
            # Commit staged changes first
            result = subprocess.run(
                ["git", "commit", "-m", "Auto-backup: config + agent workspace"],
                capture_output=True,
                text=True
            )
            if result.returncode != 0 and "nothing to commit" not in (result.stdout + result.stderr):
                print(f"Commit failed: {result.stderr}", file=sys.stderr)
                return False
            if verbose:
                print("Committed changes")
        else:
            if verbose:
                print("No staged changes, skipping commit")

        # Pull latest (rebase on top of remote) — autostash handles any dirty working tree
        result = subprocess.run(
            ["git", "pull", "--rebase", "--autostash"],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            print(f"Pull failed: {result.stderr}", file=sys.stderr)
            return False
        if verbose:
            print("Pulled latest from remote")

        # Only push if we committed something
        if has_staged:
            result = subprocess.run(["git", "push"], check=True, capture_output=True)
            if verbose:
                print("Pushed to remote")

        return True
    except subprocess.CalledProcessError as e:
        print(f"Git error: {e.stderr if e.stderr else str(e)}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"Error during commit/push: {e}", file=sys.stderr)
        return False

# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Backup OpenClaw config to Git")
    parser.add_argument("--force", action="store_true", help="Force commit even if unchanged")
    parser.add_argument("--verbose", action="store_true", help="Print verbose output")
    parser.add_argument("--check-only", action="store_true", help="Check status without committing")
    
    args = parser.parse_args()
    
    # --- Early-exit paths ---
    
    # Bail out if the primary source file doesn't exist
    if not os.path.exists(SOURCE_FILE):
        print(f"Error: {SOURCE_FILE} not found", file=sys.stderr)
        sys.exit(1)
    
    # Detect whether the source files have changed since last backup
    changed, current_hash = has_changed(verbose=args.verbose)
    
    if args.check_only:
        if changed:
            print("Config has changed (not committed)")
        else:
            print("Config unchanged")
        sys.exit(0)
    
    if not changed and not args.force:
        # Config unchanged, but agent workspace files (memory, etc.) may have changed.
        # Check for uncommitted changes in the agents/ directory.
        try:
            os.chdir(GIT_REPO)
            result = subprocess.run(
                ["git", "status", "--porcelain", "agents/"],
                capture_output=True, text=True
            )
            workspace_changed = bool(result.stdout.strip())
        except Exception:
            workspace_changed = False

        if not workspace_changed:
            if args.verbose:
                print("No changes detected, skipping commit")
            sys.exit(0)
        else:
            if args.verbose:
                print("Config unchanged but agent workspace has changes, proceeding...")
    
    # --- Perform the backup: copy → commit → push → persist hash ---
    
    if args.verbose:
        print("Config changed, proceeding with backup...")
    
    # Copy the file
    if not copy_file(verbose=args.verbose):
        sys.exit(1)
    
    # Commit and push
    if not git_commit_push(verbose=args.verbose):
        sys.exit(1)
    
    # Hash is saved only *after* a successful push so a failed push is retried
    save_hash(current_hash)
    
    if args.verbose:
        print("Backup complete!")

if __name__ == "__main__":
    main()
