---
name: agent-review
description: Weekly self-improvement analysis — scan session transcripts, tool failures, cron errors, and memory for recurring patterns; file GitHub issues for high-confidence findings; deliver prioritized suggestions to a channel.
---

# agent-review skill

Scan an OpenClaw instance's own session trajectories and daily memory notes to
surface tool failures, cron errors, and recurring friction — then file
deduplicated GitHub issues for high-confidence findings and hand a prioritized
summary to the calling agent for delivery.

---

## Overview

The skill is a single script:

- **`scripts/agent_review.py`** — Reads OpenClaw trajectory files from
  `~/.openclaw/agents/*/sessions/*.trajectory.jsonl` and daily memory markdown
  from `~/.openclaw/agents/*/memory/YYYY-MM-DD.md` over a rolling window, then
  prints a JSON diagnostics summary to stdout. With `--file-issues` it also
  opens GitHub issues (via the `gh` CLI) for findings that clear the recurrence
  thresholds, using a fingerprint state file to avoid duplicates.

The calling cron agent parses the JSON, reads recent memory for extra context,
synthesizes a prioritized review, and delivers it to a channel. Issue filing and
delivery are driven by the agent — the script only emits data and (optionally)
files the deduplicated issues.

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `AGENT_REVIEW_OUT_DIR` | `~/.openclaw/reports/agent-review` | Directory for JSON report files (overridable with `--output-dir`) |
| `AGENT_REVIEW_ISSUE_REPO` | — | `owner/repo` for issue filing (overridable with `--issue-repo`; required when `--file-issues` is set) |

Fingerprint state lives under `~/.openclaw/state/agent-review/`. Set the env
vars in your `.env` or shell, or pass the equivalent flags.

---

## Usage

### Manual run (read-only diagnostics)

```bash
python3 scripts/agent_review.py --days 7
```

### With issue filing

```bash
python3 scripts/agent_review.py \
  --days 7 \
  --file-issues \
  --issue-repo owner/repo \
  --issue-min-count 3 \
  --issue-min-runs 2 \
  --issue-max-open-per-run 3 \
  --output-dir ~/.openclaw/reports/agent-review
```

### Options

| Flag | Default | Purpose |
|---|---|---|
| `--days` | `7` | Rolling window in days (1–30) |
| `--file-issues` | off | File GitHub issues for recurring high-confidence findings |
| `--issue-repo` | `$AGENT_REVIEW_ISSUE_REPO` | Target repo for issue filing (required with `--file-issues`) |
| `--issue-min-count` | `3` | Minimum finding count in this run to consider filing |
| `--issue-min-runs` | `2` | Minimum runs the finding recurred before filing |
| `--issue-max-open-per-run` | `3` | Cap on new issues opened per run |
| `--state-file` | `~/.openclaw/state/agent-review/fingerprints.json` | Fingerprint dedup state |
| `--output-dir` | `$AGENT_REVIEW_OUT_DIR` | Directory for JSON report files |
| `--backup-retention-days` | `21` | Fingerprint backup retention |

---

## Output schema

JSON printed to stdout:

```json
{
  "tool_errors":  { "<tool>": { "count": 0, "errors": ["..."] } },
  "cron_errors":  { "<job/session key>": { "count": 0, "errors": ["..."] } },
  "cron_stats":   { "total_cron_sessions": 0, "errored_sessions": 0, "ok_sessions": 0 },
  "memory_flags": ["..."],
  "source_health": { "...": "diagnostics to avoid silent partial scans" },
  "window_days": 7
}
```

---

## Synthesis & delivery (agent steps)

The calling cron agent should:

1. Run the script (with `--file-issues` for automated triage) and parse the JSON.
2. Read the last N days of daily memory files for additional correction/friction context.
3. Synthesize findings into 🔴 Critical / 🟡 High / 🟢 Low buckets plus a cron-health line, and deliver **one** concise message to the configured channel. If nothing is found, send a short "clean week" note.
4. Mention any newly auto-filed GitHub issues and include their URLs.
5. Do not auto-commit report files from the cron run.

---

## Requirements

- Python 3.9+ (stdlib only)
- `gh` CLI authenticated for the target repo (only when `--file-issues` is used)
- Read access to `~/.openclaw/agents/*/sessions/` and `~/.openclaw/agents/*/memory/`

---

## Agent Visibility (Skill Scoping)

This skill reviews an instance's own transcripts and files issues into a private
repo, so you usually don't want it visible to every agent. Recommended pattern:

1. Keep the shared script here in `openclaw-hub` (or wherever you cloned it).
2. Create a thin agent-local wrapper in your private repo, e.g.
   `agents/root/skills/agent-review/SKILL.md`, that documents your specific
   output dir, issue repo, delivery target, and cron name and points at the
   shared script path.

This injects the skill into only the one agent that should run it while keeping
the implementation shareable.
