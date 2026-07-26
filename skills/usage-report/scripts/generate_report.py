#!/usr/bin/env python3
"""
generate_report.py — Generate weekly OpenClaw LLM usage report as Markdown.

Usage:
    python3 generate_report.py <YYYY-MM-DD> <output_dir>

Reads:
    $OPENCLAW_LOGS_DIR/usage-trends.csv
    $OPENCLAW_LOGS_DIR/usage-sessions.csv

Writes:
    <output_dir>/<YYYY-MM-DD>.md

Prints the output path on success.
"""

import sys
import csv
import json
import os
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

PACIFIC = ZoneInfo("America/Los_Angeles")

TODAY = sys.argv[1]
REPORT_DIR = sys.argv[2]

_logs = os.environ.get("OPENCLAW_LOGS_DIR", os.path.expanduser("~/.openclaw/logs"))
_openclaw_dir = Path(_logs).parent
CSV_PATH = os.path.join(_logs, "usage-trends.csv")
SESSION_CSV_PATH = os.path.join(_logs, "usage-sessions.csv")

# ── Load data ────────────────────────────────────────────────────────────────

data = []
with open(CSV_PATH) as f:
    for row in csv.DictReader(f):
        data.append(row)

session_data = []
if os.path.exists(SESSION_CSV_PATH):
    with open(SESSION_CSV_PATH) as sf:
        for row in csv.DictReader(sf):
            session_data.append(row)


def _session_first_ts(session_id: str, agent: str) -> str:
    """Return the first model.completed timestamp for a session as 'YYYY-MM-DD HH:MM PT'."""
    traj = _openclaw_dir / "agents" / agent / "sessions" / f"{session_id}.trajectory.jsonl"
    if not traj.exists():
        return ""
    try:
        with open(traj) as f:
            for line in f:
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                if d.get("type") != "model.completed":
                    continue
                ts_str = d.get("ts", "")
                if not ts_str:
                    continue
                try:
                    ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    return ts.astimezone(PACIFIC).strftime("%Y-%m-%d %H:%M")
                except Exception:
                    return ""
    except Exception:
        pass
    return ""


_ts_cache: dict = {}

dates = sorted(set(r["date"] for r in data))
last7 = dates[-7:]
date_range = f"{last7[0]} to {last7[-1]}"

# ── Aggregate ────────────────────────────────────────────────────────────────

by_agent = defaultdict(lambda: {"cost": 0, "calls": 0, "input": 0, "output": 0, "cr": 0, "cw": 0})
daily = defaultdict(float)
by_agent_day = defaultdict(lambda: defaultdict(lambda: {"cost": 0, "calls": 0, "tokens": 0}))
by_model = defaultdict(lambda: {"cost": 0, "calls": 0})
by_agent_model = defaultdict(lambda: defaultdict(lambda: {"cost": 0, "calls": 0}))

for r in data:
    if r["date"] not in last7:
        continue
    a, c, m = r["agent"], float(r["est_cost_usd"]), r["model"]
    by_agent[a]["cost"] += c
    by_agent[a]["calls"] += int(r["calls"])
    by_agent[a]["input"] += int(r["input"])
    by_agent[a]["output"] += int(r["output"])
    by_agent[a]["cr"] += int(r["cache_read"])
    by_agent[a]["cw"] += int(r["cache_write"])
    daily[r["date"]] += c
    toks = int(r["input"]) + int(r["output"]) + int(r["cache_read"]) + int(r["cache_write"])
    by_agent_day[a][r["date"]]["cost"] += c
    by_agent_day[a][r["date"]]["calls"] += int(r["calls"])
    by_agent_day[a][r["date"]]["tokens"] += toks
    by_model[m]["cost"] += c
    by_model[m]["calls"] += int(r["calls"])
    by_agent_model[a][m]["cost"] += c
    by_agent_model[a][m]["calls"] += int(r["calls"])

total_7d = sum(daily.values())
daily_avg = total_7d / 7
monthly_proj = daily_avg * 30

totals = defaultdict(int)
rates = {"input": 3.0, "cache_read": 0.30, "cache_write": 3.75, "output": 15.0}
for r in data:
    if r["date"] in last7:
        for k in ["input", "output", "cache_read", "cache_write"]:
            totals[k] += int(r[k])
token_costs = {k: totals[k] * rates[k] / 1_000_000 for k in rates}

# ── Interactive vs Automated (from session data) ─────────────────────────────

AUTO_AGENTS = {"mail", "finance", "hass-hooks", "family", "coding"}
AUTO_SESSION_PREFIXES = ("cron:", "isolated:", "subagent:")

chat_cost = 0.0
cron_cost = 0.0
for s in session_data:
    if s["date"] not in last7:
        continue
    c = float(s["est_cost_usd"])
    sk = s.get("session_id", "")
    agent = s.get("agent", "")
    cat = s.get("category", "")
    is_auto = (agent in AUTO_AGENTS or cat == "cron" or cat == "subagent"
               or any(sk.startswith(p) for p in AUTO_SESSION_PREFIXES))
    if is_auto:
        cron_cost += c
    else:
        chat_cost += c

# ── Write report ─────────────────────────────────────────────────────────────

os.makedirs(REPORT_DIR, exist_ok=True)
OUT = f"{REPORT_DIR}/{TODAY}.md"
with open(OUT, "w") as f:

    # Header / Summary
    f.write(f"# OpenClaw LLM Usage Report\n")
    f.write(f"**Period:** {date_range} · **Generated:** {TODAY}\n\n---\n\n")
    f.write("## Summary\n\n")
    f.write("```kpi\n")
    f.write(f"7-Day Total | ${total_7d:.2f} | USD\n")
    f.write(f"Daily Average | ${daily_avg:.2f} | USD/day\n")
    f.write(f"Monthly Projection | ~${monthly_proj:.0f} | USD/month\n")
    f.write("```\n\n---\n\n")

    # Section 1: Token Cost Breakdown
    f.write("## 1. Token Cost Breakdown\n\n")
    f.write("| Token Type | 7-Day Volume | Rate | Cost | Share |\n")
    f.write("|---|---|---|---|---|\n")
    for k, label in [("cache_write", "Cache write"), ("cache_read", "Cache read"), ("output", "Output"), ("input", "Input")]:
        pct = token_costs[k] / total_7d * 100 if total_7d else 0
        f.write(f"| {label} | {totals[k]:,} | ${rates[k]}/M | **${token_costs[k]:.2f}** | **{pct:.0f}%** |\n")
    f.write(f"| **Total** | | | **${total_7d:.2f}** | | <!-- total -->\n")
    f.write("\n---\n\n")

    # Section 2: Interactive vs Automated
    f.write("## 2. Interactive vs Automated\n\n")
    f.write("| Type | 7-Day Cost | Monthly Projection |\n")
    f.write("|---|---|---|\n")
    f.write(f"| Interactive (chat, heartbeat, DMs) | **${chat_cost:.2f}** | **~${chat_cost/7*30:.0f}/month** |\n")
    f.write(f"| Automated (cron jobs) | **${cron_cost:.2f}** | **~${cron_cost/7*30:.0f}/month** |\n")
    f.write(f"| **Total** | **${total_7d:.2f}** | **~${monthly_proj:.0f}/month** | <!-- total -->\n")
    f.write("\n---\n\n")

    # Section 3: Cost by Agent
    total_toks = sum(by_agent[a]["input"] + by_agent[a]["output"] + by_agent[a]["cr"] + by_agent[a]["cw"] for a in by_agent)
    f.write("## 3. Cost by Agent\n\n")
    f.write("| Agent | 7-Day Cost | Share | Tokens | API Calls | Model(s) |\n")
    f.write("|---|---|---|---|---|---|\n")
    for agent, d in sorted(by_agent.items(), key=lambda x: -x[1]["cost"]):
        pct = d["cost"] / total_7d * 100 if total_7d else 0
        toks = d["input"] + d["output"] + d["cr"] + d["cw"]
        models = "/".join(m.replace("claude-", "").replace("github-copilot/", "") for m in by_agent_model[agent])
        f.write(f"| `{agent}` | **${d['cost']:.2f}** | {pct:.0f}% | {toks:,} | {d['calls']} | {models} |\n")
    f.write(f"| **Total** | **${total_7d:.2f}** | | {total_toks:,} | | | <!-- total -->\n")
    f.write("\n---\n\n")

    # Section 3b: Session Breakdown by Agent
    agent_sessions = defaultdict(list)
    for srow in session_data:
        if srow["date"] in last7:
            agent_sessions[srow["agent"]].append(srow)

    f.write("## 3b. Session Breakdown (Top Agents)\n\n")
    HIGH_COST = 1.0
    for agent in sorted(by_agent.keys(), key=lambda a: -by_agent[a]["cost"]):
        if by_agent[agent]["cost"] < HIGH_COST:
            continue
        rows = agent_sessions.get(agent, [])
        if not rows:
            continue
        cat_agg = defaultdict(lambda: {"cost": 0.0, "calls": 0, "sessions": 0})
        for r in rows:
            k = (r["category"], r["subcategory"])
            cat_agg[k]["cost"] += float(r["est_cost_usd"])
            cat_agg[k]["calls"] += int(r["calls"])
            cat_agg[k]["sessions"] += 1
        at = by_agent[agent]["cost"]
        f.write(f"### `{agent}` \u2014 ${at:.2f} total\n\n")
        f.write("| Category | Job / Task | Sessions | Calls | Cost | Share |\n")
        f.write("|---|---|---|---|---|---|\n")
        for (cat, sub), d in sorted(cat_agg.items(), key=lambda x: -x[1]["cost"]):
            pct = d["cost"] / at * 100 if at else 0
            f.write(f"| {cat} | `{sub}` | {d['sessions']} | {d['calls']} | ${d['cost']:.2f} | {pct:.0f}% |\n")
        f.write("\n")

    # Section 3c: Cron Job Summary
    cron_agg = defaultdict(lambda: {"cost": 0.0, "calls": 0, "runs": 0, "tokens": 0})
    for srow in session_data:
        if srow["date"] in last7 and srow["category"] == "cron":
            k = srow["subcategory"]
            cron_agg[k]["cost"] += float(srow["est_cost_usd"])
            cron_agg[k]["calls"] += int(srow["calls"])
            cron_agg[k]["runs"] += 1
            cron_agg[k]["tokens"] += (int(srow.get("input", 0)) + int(srow.get("output", 0))
                                       + int(srow.get("cache_read", 0)) + int(srow.get("cache_write", 0)))
    if cron_agg:
        f.write("---\n\n## 3c. Cron Job Summary (All Agents)\n\n")
        f.write("| Job | Runs (7d) | Calls | Tokens | Cost |\n")
        f.write("|---|---|---|---|---|\n")
        for job, d in sorted(cron_agg.items(), key=lambda x: -x[1]["cost"]):
            f.write(f"| `{job}` | {d['runs']} | {d['calls']} | {d['tokens']:,} | ${d['cost']:.2f} |\n")
        f.write("\n")

    # Section 4: Daily Trend
    f.write("---\n\n## 4. Daily Trend\n\n")
    f.write("| Date | Cost | Notes |\n")
    f.write("|---|---|---|\n")
    for date in last7:
        cost = daily.get(date, 0)
        f.write(f"| {date} | ${cost:.2f} | |\n")
    f.write("\n---\n\n")

    # Section 5: Model Split
    f.write("## 5. Model Split\n\n")
    f.write("| Model | 7-Day Cost | Calls | Share |\n")
    f.write("|---|---|---|---|\n")
    for model, d in sorted(by_model.items(), key=lambda x: -x[1]["cost"]):
        short = model.replace("claude-", "").replace("github-copilot/", "")
        pct = d["cost"] / total_7d * 100 if total_7d else 0
        f.write(f"| `{short}` | ${d['cost']:.2f} | {d['calls']} | {pct:.1f}% |\n")
    f.write("\n---\n\n")

    # Section 6: Itemized Session Log (phone-bill style, sorted by date+time)
    f.write("## 6. Itemized Session Log\n\n")
    f.write("| Date/Time (PT) | Agent | Category | Label / Description | Cost |\n")
    f.write("|---|---|---|---|---|\n")
    week_sessions = [s for s in session_data if s["date"] in last7]
    # Augment with first timestamp so we can sort and display chronologically
    for s in week_sessions:
        sid = s["session_id"]
        if sid not in _ts_cache:
            _ts_cache[sid] = _session_first_ts(sid, s["agent"])
        s["_first_ts"] = _ts_cache[sid] or s["date"]
    week_sessions.sort(key=lambda s: (s["_first_ts"], s["agent"]))
    for s in week_sessions:
        cost = float(s["est_cost_usd"])
        if cost < 0.01:
            continue
        label = (s.get("label") or s.get("subcategory") or s.get("category") or "").strip()
        # Strip embedded pipes and newlines to avoid breaking table columns
        label = label.replace("|", "/").replace("\n", " ").replace("\r", "")[:80]
        sub = s.get("subcategory", "")
        cat = s["category"]
        cat_col = f"{cat}/{sub}" if sub and sub not in ("unknown", "") and sub != cat else cat
        ts_col = s["_first_ts"]
        f.write(f"| {ts_col} | `{s['agent']}` | {cat_col} | {label} | ${cost:.3f} |\n")
    f.write("\n---\n\n")

    # Section 7: Recommendations
    prev7 = dates[-14:-7] if len(dates) >= 14 else []
    prev_total = sum(float(r["est_cost_usd"]) for r in data if r["date"] in prev7)
    wow_pct = ((total_7d - prev_total) / prev_total * 100) if prev_total else None

    driver_agg = defaultdict(lambda: {"cost": 0.0, "sessions": 0})
    for srow in session_data:
        if srow["date"] in last7:
            k = (srow["agent"], srow["category"], srow["subcategory"])
            driver_agg[k]["cost"] += float(srow["est_cost_usd"])
            driver_agg[k]["sessions"] += 1
    top_drivers = sorted(driver_agg.items(), key=lambda x: -x[1]["cost"])[:3]

    haiku_candidates = defaultdict(lambda: {"cost": 0.0, "sessions": 0})
    for srow in session_data:
        if srow["date"] in last7 and srow["category"] in ("cron", "hook", "pipeline", "subagent"):
            m = srow["model"].lower()
            if "sonnet" in m or "opus" in m:
                k = (srow["agent"], srow["subcategory"] or srow["category"])
                haiku_candidates[k]["cost"] += float(srow["est_cost_usd"])
                haiku_candidates[k]["sessions"] += 1
    haiku_cands = sorted(haiku_candidates.items(), key=lambda x: -x[1]["cost"])[:5]

    session_totals = [(srow, int(srow["total"])) for srow in session_data if srow["date"] in last7]
    if session_totals:
        sorted_tok = sorted(t for _, t in session_totals)
        p75_idx = int(len(sorted_tok) * 0.75)
        p75 = sorted_tok[p75_idx] if p75_idx < len(sorted_tok) else 0
        threshold = max(p75 * 3, 1_000_000)
        outliers = sorted([(s, t) for s, t in session_totals if t >= threshold], key=lambda x: -x[1])
    else:
        outliers = []
        threshold = 0
        p75 = 0

    f.write("## 7. Recommendations\n\n")

    f.write("### 7.1 Top 3 Cost Drivers\n\n")
    f.write("| Rank | Agent | Category | Job/Task | Sessions | Cost | Share |\n")
    f.write("|---|---|---|---|---|---|---|\n")
    for rank, ((agent, cat, sub), d) in enumerate(top_drivers, 1):
        pct = d["cost"] / total_7d * 100 if total_7d else 0
        f.write(f"| {rank} | `{agent}` | {cat} | `{sub or '—'}` | {d['sessions']} | ${d['cost']:.2f} | {pct:.0f}% |\n")
    f.write("\n")

    f.write("### 7.2 Week-over-Week Cost Trend\n\n")
    if wow_pct is not None:
        arrow = "📈" if wow_pct > 0 else ("📉" if wow_pct < 0 else "➡️")
        f.write("| This week | Last week | Change |\n")
        f.write("|---|---|---|\n")
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
            saving_est = d["cost"] * 0.65
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
            sid_short = srow["session_id"][:20] + "..."
            f.write(f"| `{srow['agent']}` | `{sid_short}` | {tok:,} | ${float(srow['est_cost_usd']):.2f} | {srow['category']}/{srow['subcategory']} |\n")
    else:
        f.write("✅ No unusually large sessions detected this week.\n")
    f.write("\n---\n\n")

    # Section 8: Pricing Reference
    f.write("## 8. Pricing Reference\n\n")
    f.write("Rates are per 1M tokens via GitHub Copilot usage-based billing (1 AI Credit = $0.01 USD).\n\n")
    f.write("| Model | Input | Cached input | Cache write | Output |\n")
    f.write("|---|---|---|---|---|\n")
    f.write("| claude-sonnet-4.6 | $3.00 | $0.30 | $3.75 | $15.00 |\n")
    f.write("| claude-haiku-4.5 | $1.00 | $0.10 | $1.25 | $5.00 |\n")
    f.write("| claude-opus-4.x | $5.00 | $0.50 | $6.25 | $25.00 |\n")
    f.write("| gemini-2.5-pro | $1.25 | $0.125 | — | $10.00 |\n")
    f.write("| gpt-5.4 | $2.50 | $0.25 | — | $15.00 |\n")
    f.write("| gpt-5.4-mini | $0.75 | $0.075 | — | $4.50 |\n")
    f.write("\nSource: <https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing>\n")

print(f"Written: {OUT}")
