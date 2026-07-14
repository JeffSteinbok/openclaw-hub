#!/usr/bin/env python3
"""
OpenClaw Usage Summary — Token usage aggregation and cost estimation.

Reads OpenClaw trajectory files from the configured logs directory and aggregates
token usage and estimated cost by date/agent/provider/model. Writes two CSVs:

  - usage-trends.csv  (daily aggregate rows)
  - usage-sessions.csv (per-session granular rows)

The logs directory defaults to ~/.openclaw/logs but can be overridden with
the OPENCLAW_LOGS_DIR environment variable.

Data flow:
  <OPENCLAW_DIR>/agents/*/sessions/*.trajectory.jsonl
    -> parse model.completed events
    -> aggregate by (date, agent, provider, model)
    -> update <LOGS_DIR>/usage-trends.csv (atomic rewrite)
    -> update <LOGS_DIR>/usage-sessions.csv (per-session granular)
    -> print summary to stdout

Usage:
  python3 usage_summary.py              # weekly summary (default)
  python3 usage_summary.py --days 30    # last 30 days
  python3 usage_summary.py --all        # all time
  python3 usage_summary.py --csv        # write/update trends CSV only (no stdout)
  python3 usage_summary.py --post       # post summary to a configured channel
"""

import json, os, re, sys, csv, tempfile, shutil
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from collections import defaultdict
from pathlib import Path

PACIFIC = ZoneInfo("America/Los_Angeles")

# Respect OPENCLAW_LOGS_DIR env var override
_logs_dir_env = os.environ.get("OPENCLAW_LOGS_DIR")
if _logs_dir_env:
    LOGS_DIR = Path(_logs_dir_env)
    OPENCLAW_DIR = LOGS_DIR.parent
else:
    OPENCLAW_DIR = Path.home() / ".openclaw"
    LOGS_DIR = OPENCLAW_DIR / "logs"

AGENTS_DIR = OPENCLAW_DIR / "agents"
TRENDS_CSV = LOGS_DIR / "usage-trends.csv"
SESSION_CSV = LOGS_DIR / "usage-sessions.csv"
LABELS_CSV = LOGS_DIR / "session-labels.csv"
DISCORD_CHANNEL = os.environ.get("USAGE_REPORT_CHANNEL", "")

# Per-model pricing (per 1M tokens). Source: docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing
# All via GitHub Copilot; 1 AI Credit = $0.01 USD
MODEL_PRICING = {
    # Anthropic
    "claude-haiku-4.5":  dict(inp=1.00, out=5.00,  cr=0.10, cw=1.25),
    "claude-sonnet-4":   dict(inp=3.00, out=15.00, cr=0.30, cw=3.75),
    "claude-sonnet-4.5": dict(inp=3.00, out=15.00, cr=0.30, cw=3.75),
    "claude-sonnet-4.6": dict(inp=3.00, out=15.00, cr=0.30, cw=3.75),
    "claude-opus-4.5":   dict(inp=5.00, out=25.00, cr=0.50, cw=6.25),
    "claude-opus-4.6":   dict(inp=5.00, out=25.00, cr=0.50, cw=6.25),
    # Google
    "gemini-2.5-pro":    dict(inp=1.25, out=10.00, cr=0.125, cw=0),
    "gemini-3.5-flash":  dict(inp=1.50, out=9.00,  cr=0.15,  cw=0),
    # OpenAI
    "gpt-5.4":           dict(inp=2.50, out=15.00, cr=0.25, cw=0),
    "gpt-5.4-mini":      dict(inp=0.75, out=4.50,  cr=0.075, cw=0),
    "gpt-5.4-nano":      dict(inp=0.20, out=1.25,  cr=0.02,  cw=0),
    "gpt-5-mini":        dict(inp=0.25, out=2.00,  cr=0.025, cw=0),
}
# Fallback if model not in table — use sonnet-4.6 rates
_DEFAULT_PRICE = MODEL_PRICING["claude-sonnet-4.6"]

TRENDS_FIELDS = ["date","agent","provider","model","calls",
                 "input","output","cache_read","cache_write","total","est_cost_usd"]
SESSION_FIELDS = ["date","agent","session_id","provider","model",
                  "category","subcategory","label",
                  "calls","input","output","cache_read","cache_write","total","est_cost_usd"]

AUTO_AGENTS = {"mail","finance","hass-hooks","family","coding"}
AUTO_SESSION_PREFIXES = ("cron:","isolated:","subagent:")

args = sys.argv[1:]
DAYS = 7
if "--all" in args:
    DAYS = None
elif "--days" in args:
    DAYS = int(args[args.index("--days") + 1])
POST_TO_DISCORD = "--post" in args
CSV_ONLY = "--csv" in args


def _model_price(model_id: str) -> dict:
    # Strip provider prefix (e.g. "github-copilot/claude-sonnet-4.6" -> "claude-sonnet-4.6")
    key = model_id.split("/")[-1].lower() if model_id else ""
    return MODEL_PRICING.get(key, _DEFAULT_PRICE)

def est_cost(inp, out, cr, cw=0, model=None):
    p = _model_price(model) if model else _DEFAULT_PRICE
    return (inp*p["inp"] + out*p["out"] + cr*p["cr"] + cw*p["cw"]) / 1_000_000


def parse_trajectory(path, since_ts):
    agent = path.parts[-3]
    try:
        with open(path) as f:
            for line in f:
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                if d.get("type") != "model.completed":
                    continue
                ts_str = d.get("ts","")
                try:
                    ts = datetime.fromisoformat(ts_str.replace("Z","+00:00"))
                except Exception:
                    continue
                if since_ts and ts < since_ts:
                    continue
                usage = d.get("data",{}).get("usage",{})
                if not usage:
                    continue
                yield ts, agent, d.get("sessionKey",""), d.get("runId",""),                       d.get("provider","unknown"), d.get("modelId","unknown"), usage
    except Exception:
        pass


def extract_session_label(session_file):
    """
    Classify a session by reading its first user message.
    Returns (category, subcategory, label).
    Categories: cron / subagent / interactive / pipeline / unknown
    """
    try:
        with open(session_file) as f:
            for raw in f:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    obj = json.loads(raw)
                except Exception:
                    continue
                if obj.get("type") != "message":
                    continue
                msg = obj.get("message",{})
                if msg.get("role") != "user":
                    continue
                content = msg.get("content","")
                if isinstance(content, list):
                    text = " ".join(c["text"] for c in content
                                    if isinstance(c,dict) and c.get("type")=="text")
                elif isinstance(content, str):
                    text = content
                else:
                    continue

                # Cron job
                m = re.match(r'\[cron:[^\]]*?([\w-]+)\]', text)
                if m:
                    job_name = m.group(1)
                    rest = text[m.end():].strip()[:80].replace("\n"," ")
                    return ("cron", job_name, rest or job_name)

                # Subagent
                if "[Subagent Task]" in text or "[Subagent Context]" in text:
                    tm = re.search(r'\[Subagent Task\]\s*(.+?)(?:\n|$)', text)
                    if tm:
                        task_text = tm.group(1).strip()[:100]
                    else:
                        task_text = ""
                        for ln in [l.strip() for l in text.split("\n") if l.strip()]:
                            if ln.startswith("["):
                                continue
                            task_text = ln[:100]
                            break
                    return ("subagent","subagent", task_text or "subagent task")

                # Pipeline
                if "SYSTEM SECURITY NOTICE" in text or "automated email pipeline" in text:
                    return ("pipeline","mail-sse","automated mail pipeline")
                if "[Inter-session message]" in text:
                    src = re.search(r'sourceSession=([^\s]+)', text)
                    sl = src.group(1) if src else "unknown"
                    return ("pipeline","inter-session",f"inter-session from {sl}")

                # Interactive
                return ("interactive","chat", text[:80].replace("\n"," "))
    except Exception:
        pass
    return ("unknown","unknown","")


def load_enriched_labels():
    """
    Load session-labels.csv written by enrich_sessions.py.
    Returns dict of {session_id: (category, subcategory, label)} for
    sessions with high or medium confidence labels.
    """
    enriched = {}
    if not LABELS_CSV.exists():
        return enriched
    try:
        with open(LABELS_CSV) as f:
            for row in csv.DictReader(f):
                conf = row.get("confidence", "low")
                if conf in ("high", "medium"):
                    enriched[row["session_id"]] = (
                        row["category"],
                        row["subcategory"],
                        row.get("label", ""),
                    )
    except Exception:
        pass
    return enriched


def main():
    now = datetime.now(tz=timezone.utc)
    since = now - timedelta(days=DAYS) if DAYS else None

    agg = defaultdict(lambda: dict(calls=0,input=0,output=0,cache_read=0,cache_write=0,total=0))
    agg_agent_day = defaultdict(lambda: dict(calls=0,cost=0.0))
    agg_type_day  = defaultdict(lambda: dict(calls=0,cost=0.0))
    session_agg   = defaultdict(lambda: dict(calls=0,input=0,output=0,cache_read=0,cache_write=0,total=0))
    session_labels = {}
    enriched_labels = load_enriched_labels()

    for path in AGENTS_DIR.glob("*/sessions/*.trajectory.jsonl"):
        sf = Path(str(path).replace(".trajectory.jsonl",".jsonl"))
        sid = path.stem.replace(".trajectory","")

        for ts, agent, sk, rid, provider, model, usage in parse_trajectory(path, since):
            ds = ts.astimezone(PACIFIC).strftime("%Y-%m-%d")
            key = (ds,agent,provider,model)
            for f,k in [("input","input"),("output","output"),
                        ("cacheRead","cache_read"),("cacheWrite","cache_write"),("total","total")]:
                agg[key][k] += usage.get(f,0)
            agg[key]["calls"] += 1

            cc = est_cost(usage.get("input",0),usage.get("output",0),
                          usage.get("cacheRead",0),usage.get("cacheWrite",0),
                          model=model)
            agg_agent_day[(ds,agent)]["calls"] += 1
            agg_agent_day[(ds,agent)]["cost"]  += cc

            is_auto = agent in AUTO_AGENTS or any(sk.startswith(p) for p in AUTO_SESSION_PREFIXES)
            kind = "automated" if is_auto else "interactive"
            agg_type_day[(ds,kind)]["calls"] += 1
            agg_type_day[(ds,kind)]["cost"]  += cc

            s_key = (ds,agent,sid,provider,model)
            for f,k in [("input","input"),("output","output"),
                        ("cacheRead","cache_read"),("cacheWrite","cache_write"),("total","total")]:
                session_agg[s_key][k] += usage.get(f,0)
            session_agg[s_key]["calls"] += 1

            if sid not in session_labels:
                if sid in enriched_labels:
                    # Use higher-fidelity label from enrich_sessions.py
                    session_labels[sid] = enriched_labels[sid]
                elif sf.exists():
                    session_labels[sid] = extract_session_label(sf)
                elif sk.startswith("cron:"):
                    job = sk.split(":")[-1]
                    session_labels[sid] = ("cron",job,job)
                else:
                    session_labels[sid] = ("unknown","unknown","")

    # ── Trends CSV ──────────────────────────────────────────────────────────
    TRENDS_CSV.parent.mkdir(parents=True, exist_ok=True)
    ex_keys, ex_rows = set(), []
    if TRENDS_CSV.exists():
        with open(TRENDS_CSV) as f:
            for row in csv.DictReader(f):
                ex_rows.append(row)
                ex_keys.add((row["date"],row["agent"],row["provider"],row["model"]))

    new_rows = []
    for (ds,agent,provider,model),u in sorted(agg.items()):
        k = (ds,agent,provider,model)
        cost = est_cost(u["input"],u["output"],u["cache_read"],u["cache_write"],model=model)
        row = dict(date=ds,agent=agent,provider=provider,model=model,
                   calls=u["calls"],input=u["input"],output=u["output"],
                   cache_read=u["cache_read"],cache_write=u["cache_write"],
                   total=u["total"],est_cost_usd=f"{cost:.4f}")
        if k not in ex_keys:
            new_rows.append(row); ex_rows.append(row)
        else:
            for r in ex_rows:
                if (r["date"],r["agent"],r["provider"],r["model"]) == k:
                    r.update(row); break

    fd,tmp = tempfile.mkstemp(dir=TRENDS_CSV.parent, suffix=".tmp")
    with os.fdopen(fd,"w",newline="") as f:
        w = csv.DictWriter(f, fieldnames=TRENDS_FIELDS)
        w.writeheader(); w.writerows(sorted(ex_rows, key=lambda r:(r["date"],r["agent"])))
    shutil.move(tmp, TRENDS_CSV)
    print(f"Updated {TRENDS_CSV} ({len(new_rows)} new rows, {len(ex_rows)} total)")

    # ── Sessions CSV ────────────────────────────────────────────────────────
    sx_keys, sx_rows = set(), []
    if SESSION_CSV.exists():
        with open(SESSION_CSV) as f:
            for row in csv.DictReader(f):
                sx_rows.append(row)
                sx_keys.add((row["date"],row["agent"],row["session_id"],row["provider"],row["model"]))

    new_srows = []
    for (ds,agent,sid,provider,model),u in sorted(session_agg.items()):
        sk = (ds,agent,sid,provider,model)
        cat,sub,lbl = session_labels.get(sid,("unknown","unknown",""))
        cost = est_cost(u["input"],u["output"],u["cache_read"],u["cache_write"],model=model)
        row = dict(date=ds,agent=agent,session_id=sid,provider=provider,model=model,
                   category=cat,subcategory=sub,label=lbl[:120],
                   calls=u["calls"],input=u["input"],output=u["output"],
                   cache_read=u["cache_read"],cache_write=u["cache_write"],
                   total=u["total"],est_cost_usd=f"{cost:.4f}")
        if sk not in sx_keys:
            new_srows.append(row); sx_rows.append(row)
        else:
            for r in sx_rows:
                if (r["date"],r["agent"],r["session_id"],r["provider"],r["model"]) == sk:
                    # Always overwrite label fields — enriched labels may have improved since first write
                    r["category"] = cat
                    r["subcategory"] = sub
                    r["label"] = lbl[:120]
                    # Also refresh token/cost counts in case trajectory grew
                    r.update({k: row[k] for k in ("calls","input","output","cache_read","cache_write","total","est_cost_usd")})
                    break

    fd2,tmp2 = tempfile.mkstemp(dir=SESSION_CSV.parent, suffix=".tmp")
    with os.fdopen(fd2,"w",newline="") as f:
        w = csv.DictWriter(f, fieldnames=SESSION_FIELDS)
        w.writeheader()
        w.writerows(sorted(sx_rows, key=lambda r:(r["date"],r["agent"],r["session_id"])))
    shutil.move(tmp2, SESSION_CSV)
    print(f"Updated {SESSION_CSV} ({len(new_srows)} new session rows, {len(sx_rows)} total)")

    if CSV_ONLY:
        return

    # ── Summary output ──────────────────────────────────────────────────────
    totals = defaultdict(lambda: dict(calls=0,input=0,output=0,cache_read=0,cache_write=0,total=0))
    grand  = dict(calls=0,input=0,output=0,cache_read=0,cache_write=0,total=0)
    for (ds,agent,provider,model),u in agg.items():
        for k in grand:
            totals[agent][k] += u[k]; grand[k] += u[k]

    total_cost   = est_cost(grand["input"],grand["output"],grand["cache_read"],grand["cache_write"])
    window_label = f"last {DAYS}d" if DAYS else "all time"

    all_dates = sorted(set(d for d,_ in agg_agent_day))
    all_agents_seen = sorted(set(a for _,a in agg_agent_day))
    cw = 8
    hdr = f"{'Date':<12}" + "".join(f"{a[:cw]:>{cw}}" for a in all_agents_seen) + f"{'Total':>{cw}}"
    dag = ["**Daily Cost by Agent**","```",hdr,"-"*len(hdr)]
    for d in all_dates:
        rt = sum(agg_agent_day[(d,a)]["cost"] for a in all_agents_seen)
        dag.append(f"{d:<12}" + "".join(f"{agg_agent_day[(d,a)]['cost']:>{cw}.2f}" for a in all_agents_seen) + f"{rt:>{cw}.2f}")
    dag.append("```")

    dtp = ["**Daily Cost: Interactive vs Automated**","```",
           f"{'Date':<12}{'Interact':>10}{'Automated':>10}{'Total':>8}","-"*42]
    for d in all_dates:
        i = agg_type_day[(d,"interactive")]["cost"]
        a = agg_type_day[(d,"automated")]["cost"]
        dtp.append(f"{d:<12}{i:>10.2f}{a:>10.2f}{i+a:>8.2f}")
    dtp.append("```")

    lines = [f"📊 **Usage Summary** ({window_label})","",
             "**Overall**",
             f"- Calls: {grand['calls']:,}",
             f"- Tokens: {grand['total']:,} ({grand['input']:,} in / {grand['output']:,} out / {grand['cache_read']:,} cr / {grand['cache_write']:,} cw)",
             f"- Est. cost: ${total_cost:.2f} (~{int(total_cost*100):,} credits @ $0.01/credit)",
             "  *(GitHub Copilot rates — effective June 1, 2026)*","",
             "**By Agent**"]
    for agent,u in sorted(totals.items(), key=lambda x:-x[1]["total"]):
        cost = est_cost(u["input"],u["output"],u["cache_read"],u["cache_write"])
        lines.append(f"- `{agent}`: {u['total']:,} tokens · {u['calls']} calls · ~${cost:.2f}")
    lines += [""] + dag + [""] + dtp
    print("\n" + "\n".join(lines))

    if POST_TO_DISCORD and DISCORD_CHANNEL:
        import subprocess
        r = subprocess.run(["openclaw","message","send","--channel","discord",
                            "--target",DISCORD_CHANNEL,"--message","\n".join(lines),"--json"],
                           capture_output=True, text=True)
        print("Posted OK" if r.returncode==0 else f"Failed: {r.stderr}", file=sys.stderr)

if __name__ == "__main__":
    main()
