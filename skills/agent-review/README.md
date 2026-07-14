# agent-review

Weekly self-improvement analysis for an OpenClaw instance: scan its own session
trajectories and memory notes for recurring tool failures, cron errors, and
friction, file deduplicated GitHub issues for high-confidence findings, and hand
a prioritized summary to the calling agent for delivery.

---

## What It Does

`scripts/agent_review.py` reads OpenClaw trajectory files and daily memory
markdown over a rolling window and emits a JSON diagnostics summary covering:

- **Tool errors** — per-tool failure counts with sample messages
- **Cron errors** — failures grouped by job / session key
- **Cron health** — total vs errored vs clean automated sessions
- **Memory flags** — memory lines signaling corrections, failures, or friction
- **Source health** — scan diagnostics that guard against silent partial reads

With `--file-issues` it opens GitHub issues (via the `gh` CLI) for findings that
clear the recurrence thresholds, using a fingerprint state file so the same
finding is not filed twice.

---

## Requirements

- **Python 3.9+** (stdlib only — no extra packages)
- **`gh` CLI** authenticated for the target repo (only needed with `--file-issues`)
- Read access to `~/.openclaw/agents/*/sessions/` and `~/.openclaw/agents/*/memory/`

---

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `AGENT_REVIEW_OUT_DIR` | `~/.openclaw/reports/agent-review` | Where JSON report files are written (`--output-dir` overrides) |
| `AGENT_REVIEW_ISSUE_REPO` | — | `owner/repo` for issue filing (`--issue-repo` overrides; required with `--file-issues`) |

Fingerprint dedup state lives under `~/.openclaw/state/agent-review/`. Scripts
fall back to safe defaults when the env vars are unset.

---

## Scripts

| Script | Purpose |
|---|---|
| `scripts/agent_review.py` | Trajectory + memory scanner; JSON diagnostics to stdout; optional fingerprint-deduped GitHub issue filing |

---

## Wiring Up the Cron Job

Add to your `openclaw.json` cron section (the agent parses the JSON, then
synthesizes and delivers the summary):

```json
{
  "id": "agent-review-weekly",
  "name": "agent-review-weekly",
  "schedule": "0 6 * * 1",
  "timezone": "America/Los_Angeles",
  "prompt": "[cron:agent-review-weekly] Run the agent-review skill. Run scripts/agent_review.py --days 7 --file-issues --issue-repo owner/repo --output-dir $AGENT_REVIEW_OUT_DIR and parse the JSON. Read the last 7 days of memory files for context. Synthesize a prioritized weekly review (Critical/High/Low + cron health) and deliver ONE message to your channel. Mention any newly filed issue URLs. Do not auto-commit."
}
```

---

## Agent Visibility

Because this skill reviews private transcripts and files issues into a private
repo, keep it agent-local rather than global: keep the shared script here and
add a thin `agents/<name>/skills/agent-review/SKILL.md` wrapper in your private
repo that documents your specific output dir, issue repo, delivery target, and
cron name.

---

## Manual Run

```bash
# Read-only diagnostics for the last 7 days
python3 scripts/agent_review.py --days 7

# With deduplicated issue filing
python3 scripts/agent_review.py --days 7 --file-issues --issue-repo owner/repo
```
