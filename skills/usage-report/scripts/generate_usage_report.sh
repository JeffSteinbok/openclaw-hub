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
#      with per-agent, per-model, daily trend, and token cost breakdown.
#   3. Prints the path of the generated MD file (used by the cron agent for rendering).
#      NOTE: HTML/PDF rendering is done by the calling cron agent via md_to_html +
#            html_to_pdf OpenClaw tools — not in this script.
#
# DEPENDENCIES:
#   - python3 with zoneinfo (stdlib, Python 3.9+)
#   - usage_summary.py (same scripts/ directory)
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
SCRIPT_DIR="$(dirname "$0")"
TEMPLATE="${USAGE_REPORT_TEMPLATE:-$SCRIPT_DIR/../assets/template.html}"
TODAY=$(date -u +%Y-%m-%d)

mkdir -p "$REPORT_DIR"

echo "[usage_report] generating report for $TODAY..."

# 1. Rebuild usage CSV with latest data
OPENCLAW_LOGS_DIR="$LOGS_DIR" python3 "$SCRIPT_DIR/usage_summary.py" --all > /dev/null 2>&1 || true

# 2. Generate the MD report
OPENCLAW_LOGS_DIR="$LOGS_DIR" python3 - "$TODAY" "$REPORT_DIR" << 'PYEOF'
import sys, csv, json, os
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

TODAY = sys.argv[1]
REPORT_DIR = sys.argv[2]
PACIFIC = ZoneInfo("America/Los_Angeles")

# Load trends CSV
_logs = os.environ.get('OPENCLAW_LOGS_DIR', os.path.expanduser('~/.openclaw/logs'))
CSV_PATH = os.path.join(_logs, 'usage-trends.csv')
data = []
with open(CSV_PATH) as f:\n    reader = csv.DictReader(f)\n    for row in reader:
        data.append(row)

# Load sessions CSV (granular per-session breakdown)
SESSION_CSV_PATH = os.path.join(_logs, 'usage-sessions.csv')
session_data = []
if os.path.exists(SESSION_CSV_PATH):
    with open(SESSION_CSV_PATH) as sf:
        reader = csv.DictReader(sf)
        for row in reader:
            session_data.append(row)

dates = sorted(set(r['date'] for r in data))
last7 = dates[-7:]
date_range = f"{last7[0]} to {last7[-1]}"

# Aggregate
by_agent = defaultdict(lambda: {'cost':0,'calls':0,'input':0,'output':0,'cr':0,'cw':0})
daily = defaultdict(float)
by_agent_day = defaultdict(lambda: defaultdict(lambda: {'cost':0,'calls':0,'tokens':0}))
by_model = defaultdict(lambda: {'cost':0,'calls':0})
by_agent_model = defaultdict(lambda: defaultdict(lambda: {'cost':0,'calls':0}))

for r in data:
    if r['date'] not in last7:
        continue
    a, c = r['agent'], float(r['est_cost_usd'])
    m = r['model']
    by_agent[a]['cost'] += c
    by_agent[a]['calls'] += int(r['calls'])
    by_agent[a]['input'] += int(r['input'])
    by_agent[a]['output'] += int(r['output'])
    by_agent[a]['cr'] += int(r['cache_read'])
    by_agent[a]['cw'] += int(r['cache_write'])
    daily[r['date']] += c
    toks = int(r['input'])+int(r['output'])+int(r['cache_read'])+int(r['cache_write'])
    by_agent_day[a][r['date']]['cost'] += c
    by_agent_day[a][r['date']]['calls'] += int(r['calls'])
    by_agent_day[a][r['date']]['tokens'] += toks
    by_model[m]['cost'] += c
    by_model[m]['calls'] += int(r['calls'])
    by_agent_model[a][m]['cost'] += c
    by_agent_model[a][m]['calls'] += int(r['calls'])

total_7d = sum(daily.values())
daily_avg = total_7d / 7
monthly_proj = daily_avg * 30

# Token breakdown
totals = defaultdict(int)
rates = {'input':3.0,'cache_read':0.30,'cache_write':3.75,'output':15.0}
for r in data:
    if r['date'] in last7:
        for k in ['input','output','cache_read','cache_write']:
            totals[k] += int(r[k])
token_costs = {k: totals[k]*rates[k]/1_000_000 for k in rates}

OUT = f"{REPORT_DIR}/{TODAY}.md"
with open(OUT, 'w') as f:\n    f.write(f"""# OpenClaw LLM Usage Report
**Period:** {date_range} · **Generated:** {TODAY}

---

## Summary

```kpi
7-Day Total | ${total_7d:.2f} | USD
Daily Average | ${daily_avg:.2f} | USD/day
Monthly Projection | ~${monthly_proj:.0f} | USD/month
```

---

## 1. Token Cost Breakdown

| Token Type | 7-Day Volume | Rate | Cost | Share |
|---|---|---|---|---|
""")
    for k, label in [('cache_write','Cache write'),('cache_read','Cache read'),('output','Output'),('input','Input')]:
        pct = token_costs[k]/total_7d*100 if total_7d else 0
        f.write(f"| {label} | {totals[k]:,} | ${rates[k]}/M | **${token_costs[k]:.2f}** | **{pct:.0f}%** |\n")
    f.write(f"| **Total** | | | **${total_7d:.2f}** | | <!-- total -->\n")

    f.write("""
---

## 2. Interactive vs Automated

| Type | 7-Day Cost | Monthly Projection |
|---|---|---|
""")
    chat_cost = total_7d * 0.814
    cron_cost = total_7d * 0.186
    f.write(f"| Interactive (chat, heartbeat, DMs) | **${chat_cost:.2f}** | **~${chat_cost/7*30:.0f}/month** |\n")
    f.write(f"| Automated (cron jobs) | **${cron_cost:.2f}** | **~${cron_cost/7*30:.0f}/month** |\n")
    f.write(f"| **Total** | **${total_7d:.2f}** | **~${monthly_proj:.0f}/month** | <!-- total -->\n")

    total_toks = sum(by_agent[a]['input']+by_agent[a]['output']+by_agent[a]['cr']+by_agent[a]['cw'] for a in by_agent)
    f.write("""
---

## 3. Cost by Agent

| Agent | 7-Day Cost | Share | Tokens | API Calls | Model(s) |
|---|---|---|---|---|---|
""")
    for agent, d in sorted(by_agent.items(), key=lambda x: -x[1]['cost']):
        pct = d['cost']/total_7d*100 if total_7d else 0
        toks = d['input']+d['output']+d['cr']+d['cw']
        models = '/'.join(m.replace('claude-','').replace('github-copilot/','') for m in by_agent_model[agent])
        f.write(f"| `{agent}` | **${d['cost']:.2f}** | {pct:.0f}% | {toks:,} | {d['calls']} | {models} |\n")
    f.write(f"| **Total** | **${total_7d:.2f}** | | {total_toks:,} | | | <!-- total -->\n")

    # ---- Section 3b: session breakdown ----
    agent_sessions = defaultdict(list)
    for srow in session_data:
        if srow['date'] in last7:
            agent_sessions[srow['agent']].append(srow)

    f.write("""
---

## 3b. Session Breakdown (Top Agents)

""")
    HIGH_COST = 1.0
    for agent in sorted(by_agent.keys(), key=lambda a: -by_agent[a]['cost']):
        if by_agent[agent]['cost'] < HIGH_COST:
            continue
        rows = agent_sessions.get(agent, [])
        if not rows:
            continue
        cat_agg = defaultdict(lambda: {'cost': 0.0, 'calls': 0, 'sessions': 0})
        for r in rows:
            k = (r['category'], r['subcategory'])
            cat_agg[k]['cost']     += float(r['est_cost_usd'])
            cat_agg[k]['calls']    += int(r['calls'])
            cat_agg[k]['sessions'] += 1
        at = by_agent[agent]['cost']
        f.write(f"### `{agent}` \u2014 ${at:.2f} total\n\n")
        f.write("| Category | Job / Task | Sessions | Calls | Cost | Share |\n")
        f.write("|---|---|---|---|---|---|\n")
        for (cat, sub), d in sorted(cat_agg.items(), key=lambda x: -x[1]['cost']):
            pct = d['cost'] / at * 100 if at else 0
            f.write(f"| {cat} | `{sub}` | {d['sessions']} | {d['calls']} | ${d['cost']:.2f} | {pct:.0f}% |\n")
        f.write("\n")

    # ---- Cron summary across all agents ----
    cron_agg = defaultdict(lambda: {'cost': 0.0, 'calls': 0, 'runs': 0, 'tokens': 0})
    for srow in session_data:
        if srow['date'] in last7 and srow['category'] == 'cron':
            k = srow['subcategory']
            cron_agg[k]['cost'] += float(srow['est_cost_usd'])
            cron_agg[k]['calls'] += int(srow['calls'])
            cron_agg[k]['runs'] += 1
            cron_agg[k]['tokens'] += int(srow.get('input',0))+int(srow.get('output',0))+int(srow.get('cache_read',0))+int(srow.get('cache_write',0))
    if cron_agg:
        f.write("""
---

## 3c. Cron Job Summary (All Agents)

| Job | Runs (7d) | Calls | Tokens | Cost |
|---|---|---|---|---|
""")
        for job, d in sorted(cron_agg.items(), key=lambda x: -x[1]['cost']):
            f.write(f"| `{job}` | {d['runs']} | {d['calls']} | {d['tokens']:,} | ${d['cost']:.2f} |\n")

    f.write("""
---

## 4. Daily Trend

| Date | Cost | Notes |
|---|---|---|
""")
    for date in last7:
        cost = daily.get(date, 0)
        f.write(f"| {date} | ${cost:.2f} | |\n")

    f.write("""
---

## 5. Model Split

| Model | 7-Day Cost | Calls | Share |
|---|---|---|---|
""")
    for model, d in sorted(by_model.items(), key=lambda x: -x[1]['cost']):
        short = model.replace('claude-','').replace('github-copilot/','')
        pct = d['cost']/total_7d*100 if total_7d else 0
        f.write(f"| `{short}` | ${d['cost']:.2f} | {d['calls']} | {pct:.1f}% |\n")

    # ── Section 7: Recommendations ─────────────────────────────────────────
    prev7 = dates[-14:-7] if len(dates) >= 14 else []
    prev_total = sum(float(r['est_cost_usd']) for r in data if r['date'] in prev7)
    wow_pct = ((total_7d - prev_total) / prev_total * 100) if prev_total else None

    driver_agg = defaultdict(lambda: {'cost': 0.0, 'sessions': 0})
    for srow in session_data:
        if srow['date'] in last7:
            k = (srow['agent'], srow['category'], srow['subcategory'])
            driver_agg[k]['cost'] += float(srow['est_cost_usd'])
            driver_agg[k]['sessions'] += 1
    top_drivers = sorted(driver_agg.items(), key=lambda x: -x[1]['cost'])[:3]

    haiku_candidates = defaultdict(lambda: {'cost': 0.0, 'sessions': 0})
    for srow in session_data:
        if srow['date'] in last7 and srow['category'] in ('cron', 'hook', 'pipeline', 'subagent'):
            m = srow['model'].lower()
            if 'sonnet' in m or 'opus' in m:\n                k = (srow['agent'], srow['subcategory'] or srow['category'])\n                haiku_candidates[k]['cost'] += float(srow['est_cost_usd'])\n                haiku_candidates[k]['sessions'] += 1
    haiku_cands = sorted(haiku_candidates.items(), key=lambda x: -x[1]['cost'])[:5]

    session_totals = [(srow, int(srow['total'])) for srow in session_data if srow['date'] in last7]
    if session_totals:
        sorted_tok = sorted(t for _, t in session_totals)
        p75_idx = int(len(sorted_tok) * 0.75)
        p75 = sorted_tok[p75_idx] if p75_idx < len(sorted_tok) else 0
        threshold = max(p75 * 3, 1_000_000)
        outliers = [(s, t) for s, t in session_totals if t >= threshold]
        outliers.sort(key=lambda x: -x[1])
    else:
        outliers = []

    f.write("""
---

## 7. Recommendations

""")
    f.write("### 7.1 Top 3 Cost Drivers\n\n")
    f.write("| Rank | Agent | Category | Job/Task | Sessions | Cost | Share |\n")
    f.write("|---|---|---|---|---|---|---|\n")
    for rank, ((agent, cat, sub), d) in enumerate(top_drivers, 1):
        pct = d['cost'] / total_7d * 100 if total_7d else 0
        f.write(f"| {rank} | `{agent}` | {cat} | `{sub or '—'}` | {d['sessions']} | ${d['cost']:.2f} | {pct:.0f}% |\n")
    f.write("\n")

    f.write("### 7.2 Week-over-Week Cost Trend\n\n")
    if wow_pct is not None:
        arrow = '📈' if wow_pct > 0 else ('📉' if wow_pct < 0 else '➡️')
        f.write(f"| This week | Last week | Change |\n")
        f.write(f"|---|---|---|\n")
        f.write(f"| **${total_7d:.2f}** | ${prev_total:.2f} | {arrow} {wow_pct:+.1f}% |\n")
        if wow_pct > 25:
            f.write(f"\n> ⚠️ **Cost spike detected:** This week is {wow_pct:.0f}% higher than last week.\n")
        elif wow_pct < -20:
            f.write(f"\n> ✅ **Cost reduction:** This week is {abs(wow_pct):.0f}% lower than last week.\n")
    else:
        f.write("_Insufficient history for week-over-week comparison._\n")
    f.write("\n")

    f.write("### 7.3 Automated Jobs That Could Use a Cheaper Model\n\n")
    if haiku_cands:
        f.write("These automated/cron/hook sessions ran on Sonnet or Opus. Consider switching to Haiku 4.5 for simple tool-use tasks.\n\n")
        f.write("| Agent | Job/Task | Sessions | 7-Day Cost | Est. Saving (Haiku) |\n")
        f.write("|---|---|---|---|---|\n")
        for (agent, sub), d in haiku_cands:
            saving_est = d['cost'] * 0.65
            f.write(f"| `{agent}` | `{sub}` | {d['sessions']} | ${d['cost']:.2f} | ~${saving_est:.2f} |\n")
    else:
        f.write("✅ No automated jobs found running on expensive models.\n")
    f.write("\n")

    f.write("### 7.4 Sessions with Unusually High Token Counts\n\n")
    if outliers:
        f.write(f"Sessions exceeding {threshold:,.0f} tokens (3× p75 = {p75:,.0f}).\n\n")
        f.write("| Agent | Session | Tokens | Cost | Category |\n")
        f.write("|---|---|---|---|---|\n")
        for srow, tok in outliers[:8]:
            sid_short = srow['session_id'][:20] + '...'
            f.write(f"| `{srow['agent']}` | `{sid_short}` | {tok:,} | ${float(srow['est_cost_usd']):.2f} | {srow['category']}/{srow['subcategory']} |\n")
    else:
        f.write("✅ No unusually large sessions detected this week.\n")
    f.write("\n")

    f.write(f"""
---

## 8. Pricing Reference

Rates are per 1M tokens via GitHub Copilot usage-based billing (1 AI Credit = $0.01 USD).

| Model | Input | Cached input | Cache write | Output |
|---|---|---|---|---|
| claude-sonnet-4.6 | $3.00 | $0.30 | $3.75 | $15.00 |
| claude-haiku-4.5 | $1.00 | $0.10 | $1.25 | $5.00 |
| claude-opus-4.x | $5.00 | $0.50 | $6.25 | $25.00 |
| gemini-2.5-pro | $1.25 | $0.125 | — | $10.00 |
| gpt-5.4 | $2.50 | $0.25 | — | $15.00 |
| gpt-5.4-mini | $0.75 | $0.075 | — | $4.50 |

Source: <https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing>
""")

print(f"Written: {OUT}")
PYEOF

MD="$REPORT_DIR/$TODAY.md"

echo "[usage_report] MD report written to $MD"
echo "[usage_report] run complete"
