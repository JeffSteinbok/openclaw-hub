#!/usr/bin/env python3
"""
Agent Review — weekly self-improvement extraction script.

Purpose:
  Scans Octo's trajectory JSONL files (session logs) and daily memory markdown
  files to surface tool failures, cron errors, and repeated friction patterns
  that the agent-review cron skill uses to generate weekly improvement suggestions.

Data sources:
  ~/.openclaw/agents/*/sessions/*.trajectory.jsonl  — per-session event logs
  ~/.openclaw/agents/*/memory/YYYY-MM-DD.md         — daily memory notes

Output:
  JSON summary printed to stdout, containing:
    - tool_errors:  {tool_name: {count, errors: [str]}}
    - cron_errors:  {job_name/session_key: {count, errors: [str]}}
    - cron_stats:   {total_cron_sessions, errored_sessions, ok_sessions}
    - memory_flags: [str]  — lines from memory files containing correction/issue signals
    - source_health: diagnostics to avoid silent partial scans
    - window_days:  int

Usage:
  python3 agent_review.py              # last 7 days (default)
  python3 agent_review.py --days 14   # last 14 days
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# ── Config ───────────────────────────────────────────────────────────────────
OPENCLAW_DIR = Path.home() / ".openclaw"
AGENTS_DIR = OPENCLAW_DIR / "agents"
DEFAULT_REPORT_DIR = Path(
    os.environ.get("AGENT_REVIEW_OUT_DIR", str(OPENCLAW_DIR / "reports" / "agent-review"))
)

# Session key prefixes that indicate a cron/automated run
CRON_SESSION_PREFIXES = ("cron:", "isolated:")

# Keywords in memory files that signal a correction, failure, or friction event
CORRECTION_KEYWORDS = [
    r"\bcorrect(ed|ion)\b",
    r"\bwrong\b",
    r"\bactually[,\s]",
    r"\bno,\s",
    r"\bfailed\b",
    r"\bfailure\b",
    r"\bbroken\b",
    r"\bbug\b",
    r"\berror\b",
    r"\btimeout\b",
    r"\bUnknown Channel\b",
    r"\bcouldn't\b",
    r"\bcould not\b",
    r"\bdidn't work\b",
    r"\bdid not work\b",
    r"\bfriction\b",
    r"\bretry\b",
    r"\breask\b",
    r"\bre-ask\b",
]
CORRECTION_PATTERN = re.compile("|".join(CORRECTION_KEYWORDS), re.IGNORECASE)

# Max error message characters stored per unique error
MAX_ERROR_LEN = 200
# Max unique error messages stored per tool
MAX_ERRORS_PER_TOOL = 5
# Max memory flag lines to return
MAX_MEMORY_FLAGS = 30
# Max diagnostics captured per scan surface
MAX_DIAGNOSTIC_ISSUES = 20
FINGERPRINT_STATE_FILE = OPENCLAW_DIR / "state" / "agent-review" / "fingerprints.json"
FINGERPRINT_BACKUP_DIR = OPENCLAW_DIR / "state" / "agent-review" / "backups"
FINGERPRINT_BACKUP_RETENTION_DAYS = 21
DEFAULT_ISSUE_REPO = os.environ.get("AGENT_REVIEW_ISSUE_REPO", "")
DEFAULT_ISSUE_LABELS = ["agent-review", "auto-filed"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract weekly agent review diagnostics.")
    parser.add_argument(
        "--days",
        type=int,
        default=7,
        help="Rolling window in days (1-30, default: 7).",
    )
    parser.add_argument(
        "--file-issues",
        action="store_true",
        help="File GitHub issues for recurring high-confidence findings.",
    )
    parser.add_argument(
        "--issue-repo",
        default=DEFAULT_ISSUE_REPO,
        help=f"GitHub repository for issue filing (default: {DEFAULT_ISSUE_REPO}).",
    )
    parser.add_argument(
        "--issue-min-count",
        type=int,
        default=3,
        help="Minimum finding count in this run to consider issue filing (default: 3).",
    )
    parser.add_argument(
        "--issue-min-runs",
        type=int,
        default=2,
        help="Minimum runs where this finding recurred before filing (default: 2).",
    )
    parser.add_argument(
        "--issue-max-open-per-run",
        type=int,
        default=3,
        help="Maximum new issues to open in a single run (default: 3).",
    )
    parser.add_argument(
        "--state-file",
        default=str(FINGERPRINT_STATE_FILE),
        help=f"Fingerprint state file (default: {FINGERPRINT_STATE_FILE}).",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_REPORT_DIR),
        help=f"Directory to write JSON report files (default: {DEFAULT_REPORT_DIR}).",
    )
    parser.add_argument(
        "--backup-retention-days",
        type=int,
        default=FINGERPRINT_BACKUP_RETENTION_DAYS,
        help=f"Fingerprint backup retention in days (default: {FINGERPRINT_BACKUP_RETENTION_DAYS}).",
    )
    parsed = parser.parse_args()
    if parsed.days < 1 or parsed.days > 30:
        parser.error("--days must be between 1 and 30")
    if parsed.issue_min_count < 1:
        parser.error("--issue-min-count must be >= 1")
    if parsed.issue_min_runs < 1:
        parser.error("--issue-min-runs must be >= 1")
    if parsed.issue_max_open_per_run < 1:
        parser.error("--issue-max-open-per-run must be >= 1")
    if parsed.backup_retention_days < 1:
        parser.error("--backup-retention-days must be >= 1")
    if parsed.file_issues and not parsed.issue_repo:
        parser.error("--file-issues requires --issue-repo (or the AGENT_REVIEW_ISSUE_REPO env var)")
    return parsed


def add_issue(bucket: list[str], message: str) -> None:
    if len(bucket) < MAX_DIAGNOSTIC_ISSUES:
        bucket.append(message)


def normalize_error(text: str) -> str:
    lowered = text.lower()
    lowered = re.sub(r"[0-9a-f]{8}-[0-9a-f-]{27,36}", "<uuid>", lowered)
    lowered = re.sub(r"\b\d+\b", "<n>", lowered)
    lowered = re.sub(r"\s+", " ", lowered).strip()
    if not lowered:
        return "unknown-error"
    return lowered[:140]


def make_fingerprint(material: str) -> str:
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def load_fingerprint_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"version": 1, "fingerprints": {}}
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise RuntimeError(f"Invalid fingerprint state format: {path}")
    if "fingerprints" not in data or not isinstance(data["fingerprints"], dict):
        raise RuntimeError(f"Invalid fingerprint state schema: {path}")
    data.setdefault("version", 1)
    return data


def backup_fingerprint_state(state_file: Path, now: datetime, retention_days: int) -> str | None:
    if not state_file.exists():
        return None

    FINGERPRINT_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup_path = FINGERPRINT_BACKUP_DIR / f"fingerprints-{now.strftime('%Y-%m-%dT%H-%M-%SZ')}.json"
    shutil.copy2(state_file, backup_path)

    cutoff = now - timedelta(days=retention_days)
    for old_backup in FINGERPRINT_BACKUP_DIR.glob("fingerprints-*.json"):
        mtime = datetime.fromtimestamp(old_backup.stat().st_mtime, tz=timezone.utc)
        if mtime < cutoff:
            old_backup.unlink()
    return str(backup_path)


def save_fingerprint_state(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(".tmp")
    with temp_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, sort_keys=True)
        f.write("\n")
    temp_path.replace(path)


def build_issue_candidates(
    tool_errors: dict[str, dict[str, Any]],
    cron_errors: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []

    for tool_name, payload in tool_errors.items():
        errors = payload.get("errors") or []
        exemplar = normalize_error(errors[0] if errors else "unknown-error")
        key = f"tool:{tool_name}:{exemplar}"
        fp = make_fingerprint(key)
        count = int(payload.get("count", 0))
        candidates.append(
            {
                "fingerprint": fp,
                "fingerprint_material": key,
                "kind": "tool_error",
                "name": tool_name,
                "count": count,
                "exemplar_error": exemplar,
                "title": f"Recurring tool failure: {tool_name}",
                "body": (
                    "Automated finding from weekly agent review.\n\n"
                    f"- Category: tool error\n"
                    f"- Tool: `{tool_name}`\n"
                    f"- Weekly occurrences: {count}\n"
                    f"- Example error: `{exemplar}`\n\n"
                    "This was auto-filed because the issue recurred above the configured threshold."
                ),
            }
        )

    for session_key, payload in cron_errors.items():
        errors = payload.get("errors") or []
        exemplar = normalize_error(errors[0] if errors else "cron-session-error")
        key = f"cron:{session_key}:{exemplar}"
        fp = make_fingerprint(key)
        count = int(payload.get("count", 0))
        candidates.append(
            {
                "fingerprint": fp,
                "fingerprint_material": key,
                "kind": "cron_error",
                "name": session_key,
                "count": count,
                "exemplar_error": exemplar,
                "title": f"Recurring cron failure: {session_key}",
                "body": (
                    "Automated finding from weekly agent review.\n\n"
                    f"- Category: cron error\n"
                    f"- Session key: `{session_key}`\n"
                    f"- Weekly occurrences: {count}\n"
                    f"- Example error: `{exemplar}`\n\n"
                    "This was auto-filed because the issue recurred above the configured threshold."
                ),
            }
        )

    return sorted(candidates, key=lambda item: item["count"], reverse=True)


def sync_fingerprint_state(
    state: dict[str, Any],
    candidates: list[dict[str, Any]],
    now: datetime,
) -> None:
    fp_store = state["fingerprints"]
    now_iso = now.isoformat()

    for item in candidates:
        fp = item["fingerprint"]
        entry = fp_store.get(fp)
        if entry is None:
            entry = {
                "kind": item["kind"],
                "name": item["name"],
                "fingerprint_material": item["fingerprint_material"],
                "first_seen": now_iso,
                "times_seen": 0,
                "status": "open",
            }
            fp_store[fp] = entry

        entry["last_seen"] = now_iso
        entry["times_seen"] = int(entry.get("times_seen", 0)) + 1
        entry["last_weekly_count"] = item["count"]
        entry["last_error"] = item["exemplar_error"]


def create_github_issue(repo: str, title: str, body: str, labels: list[str]) -> tuple[bool, str]:
    cmd = ["gh", "issue", "create", "--repo", repo, "--title", title, "--body", body]
    for label in labels:
        cmd.extend(["--label", label])

    completed = subprocess.run(cmd, capture_output=True, text=True, check=False)
    stdout = completed.stdout.strip()
    stderr = completed.stderr.strip()
    if completed.returncode != 0:
        return False, stderr or stdout or "gh issue create failed"
    if not stdout:
        return False, "gh issue create succeeded without URL output"
    return True, stdout.splitlines()[-1].strip()


def maybe_file_issues(
    *,
    state: dict[str, Any],
    candidates: list[dict[str, Any]],
    now: datetime,
    repo: str,
    min_count: int,
    min_runs: int,
    max_open_per_run: int,
    enabled: bool,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "enabled": enabled,
        "repo": repo,
        "min_count": min_count,
        "min_runs": min_runs,
        "max_open_per_run": max_open_per_run,
        "opened": [],
        "skipped": [],
        "errors": [],
    }

    if not enabled:
        return result

    opened = 0
    fp_store = state["fingerprints"]
    now_iso = now.isoformat()

    for item in candidates:
        fp = item["fingerprint"]
        entry = fp_store[fp]
        existing_issue = entry.get("issue", {})
        has_opened_issue = bool(existing_issue.get("url"))

        if item["count"] < min_count:
            result["skipped"].append({"fingerprint": fp, "reason": "below_min_count", "count": item["count"]})
            continue
        if int(entry.get("times_seen", 0)) < min_runs:
            result["skipped"].append(
                {
                    "fingerprint": fp,
                    "reason": "below_min_runs",
                    "times_seen": int(entry.get("times_seen", 0)),
                }
            )
            continue
        if has_opened_issue:
            result["skipped"].append({"fingerprint": fp, "reason": "already_linked", "issue": existing_issue})
            continue
        if opened >= max_open_per_run:
            result["skipped"].append({"fingerprint": fp, "reason": "run_limit_reached"})
            continue

        body = f"{item['body']}\n\n- Fingerprint: `{fp}`"
        ok, payload = create_github_issue(
            repo=repo,
            title=item["title"],
            body=body,
            labels=DEFAULT_ISSUE_LABELS,
        )
        if not ok:
            result["errors"].append({"fingerprint": fp, "error": payload})
            entry["last_issue_attempt_at"] = now_iso
            entry["last_issue_attempt_error"] = payload
            continue

        entry["issue"] = {"url": payload}
        entry["last_issue_attempt_at"] = now_iso
        entry["last_issue_attempt_error"] = None
        opened += 1
        result["opened"].append({"fingerprint": fp, "issue_url": payload, "title": item["title"]})

    return result


def parse_trajectories(since_ts: datetime) -> tuple[list[dict], dict, list[str]]:
    """
    Scan all trajectory JSONL files.

    Returns:
      (events, scan_stats, scan_issues)
    """
    events: list[dict] = []
    stats = {
        "files_seen": 0,
        "files_read": 0,
        "files_unreadable": 0,
        "malformed_json_lines": 0,
        "invalid_timestamps": 0,
    }
    issues: list[str] = []

    for path in AGENTS_DIR.glob("*/sessions/*.trajectory.jsonl"):
        stats["files_seen"] += 1
        agent = path.parts[-3]
        try:
            handle = path.open(encoding="utf-8")
        except OSError as exc:
            stats["files_unreadable"] += 1
            add_issue(issues, f"unreadable trajectory file {path}: {exc}")
            continue

        stats["files_read"] += 1
        with handle:
            for line_no, line in enumerate(handle, start=1):
                try:
                    d = json.loads(line)
                except json.JSONDecodeError:
                    stats["malformed_json_lines"] += 1
                    continue

                ts_str = d.get("ts", "")
                try:
                    ts = datetime.fromisoformat(str(ts_str).replace("Z", "+00:00"))
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                except (TypeError, ValueError):
                    stats["invalid_timestamps"] += 1
                    if stats["invalid_timestamps"] <= MAX_DIAGNOSTIC_ISSUES:
                        add_issue(
                            issues,
                            f"invalid timestamp in {path}:{line_no}: {ts_str!r}",
                        )
                    continue

                if ts < since_ts:
                    continue

                event_type = d.get("type", "")
                session_key = d.get("sessionKey", "")
                is_cron = any(session_key.startswith(p) for p in CRON_SESSION_PREFIXES)

                # Tool error events
                if event_type in ("tool.error", "tool.failed"):
                    tool_name = (
                        d.get("data", {}).get("tool", "")
                        or d.get("toolName", "")
                        or d.get("tool", "")
                        or "unknown"
                    )
                    error_msg = d.get("data", {}).get("error", "") or d.get("error", "") or ""
                    events.append(
                        {
                            "ts": ts,
                            "agent": agent,
                            "session_key": session_key,
                            "event_type": event_type,
                            "tool_name": tool_name,
                            "error_msg": str(error_msg)[:MAX_ERROR_LEN],
                            "is_cron": is_cron,
                        }
                    )

                # Tool result with error payload (some gateways emit tool.result with error)
                elif event_type == "tool.result":
                    result_data = d.get("data", {})
                    if result_data.get("isError") or result_data.get("error"):
                        tool_name = result_data.get("tool", "") or d.get("toolName", "") or "unknown"
                        error_msg = result_data.get("error", "") or str(result_data.get("content", ""))
                        events.append(
                            {
                                "ts": ts,
                                "agent": agent,
                                "session_key": session_key,
                                "event_type": "tool.error",
                                "tool_name": tool_name,
                                "error_msg": str(error_msg)[:MAX_ERROR_LEN],
                                "is_cron": is_cron,
                            }
                        )

                # Session-level error or timeout
                elif event_type in ("session.error", "session.timeout", "run.error", "run.timeout"):
                    events.append(
                        {
                            "ts": ts,
                            "agent": agent,
                            "session_key": session_key,
                            "event_type": event_type,
                            "tool_name": "",
                            "error_msg": str(d.get("data", {}).get("error", event_type))[:MAX_ERROR_LEN],
                            "is_cron": is_cron,
                        }
                    )

    return events, stats, issues


def scan_memory_files(since_ts: datetime) -> tuple[list[tuple[str, str, str]], dict, list[str]]:
    """
    Scan daily memory markdown files for lines containing correction/issue signals.
    Returns (flags, scan_stats, scan_issues).
    """
    flags: list[tuple[str, str, str]] = []
    stats = {"files_seen": 0, "files_read": 0, "files_unreadable": 0, "files_in_window": 0}
    issues: list[str] = []

    # Memory files live under workspace/memory/ (workspace is a symlink per-agent)
    # We must explicitly glob both direct and workspace paths since glob() doesn't follow symlinks
    patterns = [
        "*/memory/20[0-9][0-9]-[0-9][0-9]-[0-9][0-9].md",
        "*/workspace/memory/20[0-9][0-9]-[0-9][0-9]-[0-9][0-9].md",
    ]
    seen_paths: set[Path] = set()
    all_md_paths: list[Path] = []
    for pattern in patterns:
        for p in AGENTS_DIR.glob(pattern):
            resolved = p.resolve()
            if resolved not in seen_paths:
                seen_paths.add(resolved)
                all_md_paths.append(p)

    for md_path in all_md_paths:
        stats["files_seen"] += 1
        # agent name is 2 levels up for direct path, 3 for workspace path
        parts = md_path.parts
        agent_idx = parts.index("agents") + 1 if "agents" in parts else -1
        agent = parts[agent_idx] if agent_idx >= 0 else "unknown"
        date_str = md_path.stem
        try:
            file_date = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            add_issue(issues, f"invalid memory filename date: {md_path}")
            continue
        if file_date < since_ts:
            continue
        stats["files_in_window"] += 1

        try:
            handle = md_path.open(encoding="utf-8")
        except OSError as exc:
            stats["files_unreadable"] += 1
            add_issue(issues, f"unreadable memory file {md_path}: {exc}")
            continue

        stats["files_read"] += 1
        with handle:
            for line in handle:
                line = line.rstrip()
                if not CORRECTION_PATTERN.search(line):
                    continue
                # Skip very short or heading-only lines
                stripped = line.strip("# -•*> \t")
                if len(stripped) > 20:
                    flags.append((agent, date_str, line.strip()))

    return flags, stats, issues


def main() -> None:
    parsed = parse_args()
    now = datetime.now(tz=timezone.utc)
    since = now - timedelta(days=parsed.days)
    state_file = Path(parsed.state_file).expanduser()

    tool_errors = defaultdict(lambda: {"count": 0, "errors": []})
    cron_sessions_with_errors = defaultdict(lambda: {"count": 0, "errors": []})
    all_cron_sessions = set()
    cron_sessions_errored = set()

    events, trajectory_stats, trajectory_issues = parse_trajectories(since)
    if trajectory_stats["files_seen"] == 0:
        raise RuntimeError(f"No trajectory files found under {AGENTS_DIR}/<agent>/sessions/")

    for event in events:
        session_key = event["session_key"]
        if event["is_cron"]:
            all_cron_sessions.add(session_key)

        if event["event_type"] in ("tool.error", "tool.failed"):
            tool_name = event["tool_name"]
            tool_errors[tool_name]["count"] += 1
            if len(tool_errors[tool_name]["errors"]) < MAX_ERRORS_PER_TOOL:
                msg = event["error_msg"]
                if msg and msg not in tool_errors[tool_name]["errors"]:
                    tool_errors[tool_name]["errors"].append(msg)

            if event["is_cron"]:
                cron_sessions_errored.add(session_key)
                cron_sessions_with_errors[session_key]["count"] += 1
                if len(cron_sessions_with_errors[session_key]["errors"]) < MAX_ERRORS_PER_TOOL:
                    msg = event["error_msg"]
                    if msg and msg not in cron_sessions_with_errors[session_key]["errors"]:
                        cron_sessions_with_errors[session_key]["errors"].append(msg)

        elif event["event_type"] in ("session.error", "session.timeout", "run.error", "run.timeout"):
            if event["is_cron"]:
                cron_sessions_errored.add(session_key)
                cron_sessions_with_errors[session_key]["count"] += 1

    raw_flags, memory_stats, memory_issues = scan_memory_files(since)

    # Deduplicate and trim
    seen_lines = set()
    memory_flags = []
    for agent, date_str, line in raw_flags:
        key = line.lower()
        if key in seen_lines:
            continue
        seen_lines.add(key)
        memory_flags.append(f"[{agent}/{date_str}] {line}")
        if len(memory_flags) >= MAX_MEMORY_FLAGS:
            break

    total_cron = len(all_cron_sessions)
    errored_cron = len(cron_sessions_errored)

    issue_candidates = build_issue_candidates(tool_errors, cron_sessions_with_errors)
    state = load_fingerprint_state(state_file)
    sync_fingerprint_state(state=state, candidates=issue_candidates, now=now)
    issue_filing = maybe_file_issues(
        state=state,
        candidates=issue_candidates,
        now=now,
        repo=parsed.issue_repo,
        min_count=parsed.issue_min_count,
        min_runs=parsed.issue_min_runs,
        max_open_per_run=parsed.issue_max_open_per_run,
        enabled=parsed.file_issues,
    )
    backup_path = backup_fingerprint_state(
        state_file=state_file,
        now=now,
        retention_days=parsed.backup_retention_days,
    )
    state["updated_at"] = now.isoformat()
    save_fingerprint_state(state_file, state)

    output = {
        "window_days": parsed.days,
        "generated_at": now.isoformat(),
        "tool_errors": {k: v for k, v in sorted(tool_errors.items(), key=lambda x: -x[1]["count"])},
        "cron_errors": {
            k: v for k, v in sorted(cron_sessions_with_errors.items(), key=lambda x: -x[1]["count"])
        },
        "cron_stats": {
            "total_cron_sessions": total_cron,
            "errored_sessions": errored_cron,
            "ok_sessions": total_cron - errored_cron,
        },
        "memory_flags": memory_flags,
        "source_health": {
            "trajectory_scan": trajectory_stats,
            "memory_scan": memory_stats,
            "issues": trajectory_issues + memory_issues,
        },
        "issue_candidates": issue_candidates,
        "issue_filing": issue_filing,
        "fingerprint_state": {
            "path": str(state_file),
            "backup_path": backup_path,
            "backup_retention_days": parsed.backup_retention_days,
            "known_fingerprints": len(state["fingerprints"]),
        },
    }

    report_dir = Path(parsed.output_dir).expanduser()
    report_dir.mkdir(parents=True, exist_ok=True)
    date_str = now.strftime("%Y-%m-%d")
    report_path = report_dir / f"{date_str}.json"
    with report_path.open("w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, default=str)

    print(json.dumps(output, indent=2, default=str))


if __name__ == "__main__":
    main()
