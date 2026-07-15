# usage-report

Generate a weekly LLM API usage and cost report, render to PDF, and post to a channel.

---

## What It Does

The `usage-report` skill reads OpenClaw trajectory files, aggregates token usage and estimated costs across all agents, and produces a structured Markdown report with HTML and PDF renders. The report covers:

- Token cost breakdown (input, output, cache read/write)
- Interactive vs automated session split
- Per-agent cost with session category drill-down
- Cron job summary across all agents
- Daily trend (7-day window)
- Model split (cost and call share)
- Week-over-week comparison
- Recommendations (top drivers, downgrade candidates, high-token outliers)
- Pricing reference table

---

## Requirements

- **Python 3.9+** (uses `zoneinfo` from stdlib — no extra packages needed)
- **OpenClaw** with `md_to_html` and `html_to_pdf` tools available (for rendering)
- Read access to `$OPENCLAW_LOGS_DIR` (where trajectory CSVs are written)

---

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `OPENCLAW_LOGS_DIR` | `~/.openclaw/logs` | Where usage CSVs are read from (`usage-trends.csv`, `usage-sessions.csv`) |
| `USAGE_REPORT_OUT_DIR` | `~/reports/usage` | Where MD/HTML/PDF output is written |
| `USAGE_REPORT_TEMPLATE` | `<skill>/assets/template.html` | HTML template used by `md_to_html` |
| `USAGE_REPORT_CHANNEL` | — | Discord/Slack channel target to post the report to |

Set these in your `.env` file or shell environment. Scripts fall back to safe defaults when unset.

---

## Scripts

| Script | Purpose |
|---|---|
| `scripts/usage_summary.py` | Reads trajectory files → writes `usage-trends.csv` + `usage-sessions.csv` |
| `scripts/generate_usage_report.sh` | Calls `usage_summary.py`, then generates the Markdown report |

HTML/PDF rendering is handled by the calling OpenClaw cron agent using `md_to_html` and `html_to_pdf` tools.

### Optional: `enrich_sessions.py`

An optional enrichment script (not included) can do a deeper LLM-assisted classification pass on sessions and write results to `$OPENCLAW_LOGS_DIR/session-labels.csv`. When present, `usage_summary.py` will use those enriched labels instead of its heuristic classifier.

---

## Wiring Up the Cron Job

Add to your `openclaw.json` cron section:

```json
{
  "id": "usage-report-weekly",
  "name": "weekly-usage-report",
  "schedule": "0 5 * * 1",
  "timezone": "America/Los_Angeles",
  "prompt": "[cron:weekly-usage-report] Generate the weekly LLM usage and cost report. Use the usage-report skill. Run scripts/generate_usage_report.sh, then render the MD output to HTML with md_to_html (template: $USAGE_REPORT_TEMPLATE) and to PDF with html_to_pdf. Post the PDF to $USAGE_REPORT_CHANNEL."
}
```

---

## Agent Visibility (Skill Scoping)

OpenClaw injects skills into agents based on where the SKILL.md lives:

- **Global skills** (installed via `openclaw install`) are visible to all agents.
- **Agent-local skills** (`agents/<name>/skills/<skill>/SKILL.md`) are only visible to that specific agent.

Since this skill involves billing data and private report delivery, you probably don't want it visible to all agents. The recommended pattern is:

1. Keep the shared scripts + assets here in `openclaw-hub` (or wherever you cloned it)
2. Create a thin agent-local wrapper in your private repo:
   ```
   agents/root/skills/usage-report/SKILL.md
   ```
3. That wrapper's SKILL.md references the shared script paths via env vars and documents your specific output dir, delivery channel, and cron names.

This way the skill is only injected into the one agent that should run it, while the reusable implementation stays shareable.

---

## Manual Run

```bash
# Step 1: refresh CSVs
python3 scripts/usage_summary.py --all

# Step 2: generate Markdown report
bash scripts/generate_usage_report.sh

# Step 3: in OpenClaw, render HTML + PDF with md_to_html and html_to_pdf tools
```
