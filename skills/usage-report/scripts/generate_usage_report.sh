#!/usr/bin/env bash
# =============================================================================
# generate_usage_report.sh
# =============================================================================
# PURPOSE:
#   Generates a weekly OpenClaw LLM usage report (last 7 days) as MD, HTML, PDF.
#   Called by the 'usage-report' OpenClaw cron job (typically Monday 5 AM PT).
#
# WHAT IT DOES:
#   1. Refreshes $OPENCLAW_LOGS_DIR/usage-trends.csv via usage_summary.py
#   2. Builds a Markdown report file at $USAGE_REPORT_OUT_DIR/<YYYY-MM-DD>.md
#      with per-agent, per-model, daily trend, token cost breakdown, and
#      itemized session log (Section 6).
#   3. Prints the path of the generated MD file (used by the cron agent for rendering).
#      NOTE: HTML/PDF rendering is done by the calling cron agent via md_to_html +
#            html_to_pdf OpenClaw tools — not in this script.
#
# DEPENDENCIES:
#   - python3 with zoneinfo (stdlib, Python 3.9+)
#   - usage_summary.py (same scripts/ directory)
#   - generate_report.py (same scripts/ directory)
#   - $OPENCLAW_LOGS_DIR/usage-trends.csv (written by usage_summary.py)
#
# ENVIRONMENT VARIABLES:
#   OPENCLAW_LOGS_DIR    - Root for usage CSVs (default: ~/.openclaw/logs)
#   USAGE_REPORT_OUT_DIR - Output directory for MD/HTML/PDF (default: ~/reports/usage)
#   USAGE_REPORT_TEMPLATE - HTML template path (default: <skill>/assets/template.html)
#
# OUTPUT:
#   $USAGE_REPORT_OUT_DIR/<YYYY-MM-DD>.md
# =============================================================================

set -euo pipefail

LOGS_DIR="${OPENCLAW_LOGS_DIR:-$HOME/.openclaw/logs}"
REPORT_DIR="${USAGE_REPORT_OUT_DIR:-$HOME/reports/usage}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="${USAGE_REPORT_TEMPLATE:-$SCRIPT_DIR/../assets/template.html}"
TODAY=$(date -u +%Y-%m-%d)

mkdir -p "$REPORT_DIR"

echo "[usage_report] generating report for $TODAY..."

# 1. Rebuild usage CSV with latest data
OPENCLAW_LOGS_DIR="$LOGS_DIR" python3 "$SCRIPT_DIR/usage_summary.py" --all > /dev/null 2>&1 || true

# 2. Build/update weekly aggregated CSV
OPENCLAW_LOGS_DIR="$LOGS_DIR" python3 "$SCRIPT_DIR/build_weekly_csv.py" > /dev/null 2>&1 || true

# 3. Generate the MD report via standalone script (avoids heredoc \n bug)
OPENCLAW_LOGS_DIR="$LOGS_DIR" python3 "$SCRIPT_DIR/generate_report.py" "$TODAY" "$REPORT_DIR"

MD="$REPORT_DIR/$TODAY.md"

echo "[usage_report] MD report written to $MD"
echo "[usage_report] run complete"
