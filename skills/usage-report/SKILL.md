---
name: usage-report
description: Generate a weekly LLM API usage and cost report, render to PDF, post to a channel, and commit.
---

# usage-report skill

Generate a weekly OpenClaw LLM API usage and cost report (last 7 days) as Markdown, HTML, and PDF. Posts the report to a configured channel and optionally commits it to a git repository.

---

## Overview

The skill has two scripts:

1. **`scripts/usage_summary.py`** — Reads OpenClaw trajectory files from `$OPENCLAW_LOGS_DIR/agents/*/sessions/*.trajectory.jsonl`, aggregates token usage by date/agent/provider/model, and writes two CSVs:
   - `$OPENCLAW_LOGS_DIR/usage-trends.csv` — daily aggregate rows
   - `$OPENCLAW_LOGS_DIR/usage-sessions.csv` — per-session granular rows

2. **`scripts/generate_usage_report.sh`** — Calls `usage_summary.py --all` to refresh the CSVs, then uses an embedded Python heredoc to generate a Markdown report at `$USAGE_REPORT_OUT_DIR/<YYYY-MM-DD>.md`. The report includes: token cost breakdown, interactive vs automated split, per-agent breakdown with session categories, cron job summary, daily trend, model split, week-over-week comparison, and recommendations.

HTML/PDF rendering is handled by the calling cron agent using OpenClaw's `md_to_html` and `html_to_pdf` tools (not inside the shell script).

An optional **`enrich_sessions.py`** script (not included here — run as a daily cron) can improve session label quality by doing a deeper LLM-assisted classification pass and writing to `$OPENCLAW_LOGS_DIR/session-labels.csv`. When present, `usage_summary.py` will use those enriched labels instead of its heuristic ones.

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `OPENCLAW_LOGS_DIR` | `~/.openclaw/logs` | Root directory for CSV output (usage-trends.csv, usage-sessions.csv, session-labels.csv) |
| `USAGE_REPORT_OUT_DIR` | `~/reports/usage` | Output directory for generated MD/HTML/PDF reports |
| `USAGE_REPORT_TEMPLATE` | `<skill>/assets/template.html` | HTML template used by `md_to_html` |
| `USAGE_REPORT_CHANNEL` | — | Discord/Slack channel target for posting the rendered report |

Set these in your `.env` file or shell environment. The scripts fall back to safe defaults if unset.

---

## Usage

### Manual run

```bash
# 1. Refresh CSVs (all-time scan)
python3 scripts/usage_summary.py --all

# 2. Generate the Markdown report
bash scripts/generate_usage_report.sh

# 3. In OpenClaw, render HTML and PDF using the tools:
#    md_to_html  → produces <date>.html
#    html_to_pdf → produces <date>.pdf
```

### Cron job (weekly, Monday 5 AM PT)

Add to your `openclaw.json` cron section:

```json
{
  "id": "usage-report-weekly",
  "name": "weekly-usage-report",
  "schedule": "0 5 * * 1",
  "timezone": "America/Los_Angeles",
  "prompt": "[cron:weekly-usage-report] Generate the weekly LLM usage and cost report. Use the usage-report skill. Run generate_usage_report.sh, then render the MD output to HTML with md_to_html (template: $USAGE_REPORT_TEMPLATE) and to PDF with html_to_pdf. Post the PDF link to $USAGE_REPORT_CHANNEL."
}
```

---

## Report Sections

The generated Markdown report includes:

1. **Token Cost Breakdown** — volume and cost by token type (input, output, cache read/write)
2. **Interactive vs Automated** — split between human-driven and automated/cron sessions
3. **Cost by Agent** — per-agent breakdown with share, tokens, and API calls
4. **3b. Session Breakdown** — top agents by cost with per-category drill-down
5. **3c. Cron Job Summary** — all cron jobs across all agents
6. **Daily Trend** — day-by-day cost table for the 7-day window
7. **Model Split** — cost and call share per model
8. **Recommendations** — top cost drivers, week-over-week trend, downgrade candidates, high-token outliers
9. **Pricing Reference** — current model rates (GitHub Copilot / direct API)

---

## Requirements

- Python 3.9+ (uses `zoneinfo` from stdlib)
- OpenClaw with `md_to_html` and `html_to_pdf` tools available
- `$OPENCLAW_LOGS_DIR` must be readable by the running agent
- Template HTML (`assets/template.html` or `$USAGE_REPORT_TEMPLATE`) must exist
