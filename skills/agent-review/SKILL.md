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

## Grounding rules (MUST follow)

These rules prevent the synthesis step from fabricating authoritative-sounding
recommendations that have no basis in the script's actual output.

### Only surface findings traceable to the JSON

Every suggestion or recommendation in the synthesis output **must be directly
traceable to a field in the JSON output** — specifically `tool_errors`,
`cron_errors`, `memory_flags`, or `source_health.issues`. Do **not** invent,
extrapolate, or speculate beyond what those fields contain.

### Clean-week rule

If `tool_errors`, `cron_errors`, and `memory_flags` are all empty or contain
only trivial/low-count entries, the synthesis output **must** be a short
"clean week" note. Do not fill the absence of findings with invented
suggestions.

### Schedule and cost suggestions are prohibited

The script does **not** emit per-job run frequencies, schedule expressions, or
cost data. Therefore:

- **Never recommend changing a cron job schedule** unless the JSON output
  contains an explicit `cron_job_schedules` block with the job's actual
  schedule expression.
- **Never state or estimate run counts or dollar costs** (e.g. "ran 73x/week",
  "costs $0.87/week") — the script has no such data.
- `cron_stats.total_cron_sessions` counts session-level errors, not per-job
  run frequencies. Do **not** use it to infer how often a named job runs.
- `source_health` is diagnostics about the scan itself (e.g. trajectory
  extraction quality). It is **not** a source of operational metrics and does
  not license schedule or cost recommendations.

### Memory notes do not override grounding

Memory files may provide helpful context for interpreting findings that **are**
grounded in the JSON. They do not grant permission to surface suggestions that
are absent from the JSON output — for example, memory notes mentioning a job
name do not justify inventing run-count or savings numbers for that job.

---

## ⚠️ Synthesis grounding rules (required)

These rules are non-negotiable. Violating them produces hallucinated reports.

### Every suggestion must cite a real finding

Only surface a suggestion if it is **directly traceable to a field in the JSON output** — specifically:
- `tool_errors` — a named tool with `count > 0`
- `cron_errors` — a named job/session with `count > 0`
- `memory_flags` — a line from the memory scan
- `source_health.issues` — a diagnostic warning from the scan itself

If `tool_errors`, `cron_errors`, and `memory_flags` are all empty or minimal, the output **must** be a short "clean week" note. Do not invent suggestions to fill space.

### Schedule and cost suggestions are prohibited unless data exists

The script **does not emit per-job run frequencies or cost data.** The `cron_stats` block only contains session-level counts (`total_cron_sessions`, `errored_sessions`, `ok_sessions`) — it does not contain per-job schedule expressions, run counts, or dollar costs.

Therefore:
- **Never suggest** changing a cron job's schedule without first reading that job's actual schedule expression (e.g. via `cron get <job>`).
- **Never infer** run frequency from `cron_stats.total_cron_sessions` — that field counts all cron sessions, not runs of a specific job.
- **Never fabricate** dollar-cost savings or weekly run counts. If no cost data is in the JSON, no cost estimate may appear in the output.

If schedule or cost analysis is wanted in the future, it must be added to `agent_review.py` explicitly (e.g. a `cron_schedule_stats` block with real data from `cron list`). Until then, those suggestions are **forbidden**.

### What the script does and does not emit

| Field | What it contains | What it does NOT contain |
|---|---|---|
| `tool_errors` | Per-tool failure counts + sample errors | Schedule data, cost data |
| `cron_errors` | Per-session cron failures | Per-job run frequencies |
| `cron_stats` | Total/errored/ok session counts | Per-job breakdown, costs |
| `memory_flags` | Memory lines matching correction/friction keywords | Structured data |
| `source_health` | Scan diagnostics (files read, warnings) | Operational recommendations |

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
