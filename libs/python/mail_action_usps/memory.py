#!/usr/bin/env python3
"""
Write monthly mail memory markdown files for the OpenClaw agent.

Memory files live at:
  ~/.openclaw/agents/main/workspace/memory/mail/mail_memory_YYYY-MM.md

Each file contains all mailpieces for that month with importance badges,
sender, addressee, description — searchable by the main agent for recall.
"""

import os
import json
import uuid
from datetime import datetime
from pathlib import Path

from .paths import get_analysis_file, get_long_term_memory_dir, get_state_file

GUID_NAMESPACE = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")

BADGE_LABELS = {
    "urgent": "🚨 Urgent",
    "high": "⚠️ Important",
    "medium": "📬 Medium",
    "low": "📭 Low",
    "junk": "🗑️ Junk",
    "ad": "📢 Ad",
    "unknown": "❓ Unknown",
}


def _fmt_date(ds: str) -> str:
    try:
        dt = datetime.strptime(ds, "%Y-%m-%d")
        return dt.strftime("%A, %B %-d, %Y")
    except Exception:
        return ds


def make_guid(date_str: str, image_name: str) -> str:
    """Deterministic GUID for a mailpiece (date + filename)."""
    return str(uuid.uuid5(GUID_NAMESPACE, f"{date_str}/{image_name}"))


def load_analysis(workspace_agent: str) -> dict:
    """Load accumulated analysis history.
    
    Handles two formats:
      - Flat: {date: {file: info}}
      - v2 nested: {"data": {date: {file: info}}, "_meta/...": ...}
    Returns normalized date-keyed data.
    """
    analysis_file = get_analysis_file(workspace_agent)
    if analysis_file.exists():
        with open(analysis_file) as f:
            raw = json.load(f)

        # v2 format wraps everything under a "data" key
        if "data" in raw and isinstance(raw["data"], dict):
            # Check if "data" is the wrapper or an actual date key
            first_val = next(iter(raw["data"].values()), None)
            if isinstance(first_val, dict) and any(
                k.endswith(".jpg") for k in first_val.keys()
            ):
                return raw["data"]

        # Flat format or already clean
        return {k: v for k, v in raw.items()
                if not k.startswith("_meta") and isinstance(v, dict)}
    return {}


def save_analysis(data: dict, workspace_agent: str):
    """Atomic write of analysis history."""
    analysis_file = get_analysis_file(workspace_agent)
    os.makedirs(analysis_file.parent, exist_ok=True)
    tmp = str(analysis_file) + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, analysis_file)


def save_to_analysis(date_str: str, items: dict, workspace_agent: str):
    """Merge new items into analysis.json for a given date."""
    data = load_analysis(workspace_agent)
    existing = data.get(date_str, {})
    existing.update(items)
    data[date_str] = existing
    save_analysis(data, workspace_agent)


def write_memory_for_date(date_str: str, items: list, memory_agent: str):
    """
    Update the monthly memory file with entries for a single date.

    items: list of dicts with sender, addressee, description, importance, etc.
    """
    month = date_str[:7]  # YYYY-MM
    memory_dir = get_long_term_memory_dir(memory_agent)
    mem_path = memory_dir / f"mail_memory_{month}.md"
    os.makedirs(memory_dir, exist_ok=True)

    # Read existing file to check if this date is already written
    existing_content = ""
    if mem_path.exists():
        existing_content = mem_path.read_text()

    # If date already in file, skip (idempotent)
    if f"## {_fmt_date(date_str)} ({date_str})" in existing_content:
        return str(mem_path)

    # Build the new date section
    lines = [f"\n## {_fmt_date(date_str)} ({date_str})\n"]
    for item in items:
        sender = item.get("sender", "Unknown")
        addressee = item.get("addressee", "Unknown")
        imp = item.get("importance", "unknown")
        badge = BADGE_LABELS.get(imp, imp)
        mail_class = item.get("mail_class", "")
        desc = item.get("description", "")
        addr_method = item.get("address_method", "")
        mtype = item.get("type", "scan")
        guid = item.get("guid", "")

        lines.append(f"- **{sender}** → {addressee}  ")
        meta_parts = [badge]
        if mail_class:
            meta_parts.append(mail_class)
        if addr_method:
            meta_parts.append(addr_method)
        if mtype == "ad":
            meta_parts.append("Ad")
        lines.append(f"  {' | '.join(meta_parts)}  \n")
        if desc:
            lines.append(f"  {desc}  \n")
        if guid:
            lines.append(f"  `{guid[:8]}`  \n")

    new_section = "".join(lines)

    if not existing_content:
        # New file — add header
        month_label = datetime.strptime(month, "%Y-%m").strftime("%B %Y")
        header = f"# Mail Memory — {month_label}\n"
        mem_path.write_text(header + new_section)
    else:
        # Append to existing — insert after header, before first ## that's older
        # Simple approach: append at end
        with open(mem_path, "a") as f:
            f.write(new_section)

    return str(mem_path)


def lookup(guid: str = None, date: str = None, search: str = None, workspace_agent: str = None) -> list:
    """Search analysis history. Returns list of (date, filename, info) tuples."""
    if not workspace_agent:
        raise ValueError("workspace_agent is required")
    data = load_analysis(workspace_agent)
    results = []

    for d, files in data.items():
        if date and date not in d:
            continue
        for fname, info in files.items():
            entry_guid = info.get("guid", make_guid(d, fname))
            if guid and guid not in entry_guid:
                continue
            if search:
                haystack = " ".join(str(v) for v in info.values()).lower()
                if search.lower() not in haystack:
                    continue
            results.append((d, fname, info))

    return results


def get_stats(workspace_agent: str = None) -> dict:
    """Compute statistics across all analyzed mail."""
    if not workspace_agent:
        raise ValueError("workspace_agent is required")
    data = load_analysis(workspace_agent)
    total = 0
    imp_totals = {}
    sender_counts = {}
    addressee_counts = {}

    for date_str, files in data.items():
        for fname, info in files.items():
            total += 1
            imp = info.get("importance", "unknown")
            imp_totals[imp] = imp_totals.get(imp, 0) + 1
            s = info.get("sender", "Unknown")
            sender_counts[s] = sender_counts.get(s, 0) + 1
            a = info.get("addressee", "Unknown")
            addressee_counts[a] = addressee_counts.get(a, 0) + 1

    return {
        "total_pieces": total,
        "delivery_days": len(data),
        "by_importance": dict(sorted(imp_totals.items(), key=lambda x: -x[1])),
        "top_senders": dict(sorted(sender_counts.items(), key=lambda x: -x[1])[:10]),
        "top_addressees": dict(sorted(addressee_counts.items(), key=lambda x: -x[1])[:10]),
    }


# ---------------------------------------------------------------------------
# State tracking — last poll timestamp and processed message IDs
# ---------------------------------------------------------------------------

def load_state(workspace_agent: str) -> dict:
    """Load workflow state (last_checked_at, processed message IDs, etc.)."""
    state_file = get_state_file(workspace_agent)
    if state_file.exists():
        with open(state_file) as f:
            return json.load(f)
    return {}


def save_state(state: dict, workspace_agent: str):
    """Atomic write of workflow state."""
    state_file = get_state_file(workspace_agent)
    os.makedirs(state_file.parent, exist_ok=True)
    tmp = str(state_file) + ".tmp"
    with open(tmp, "w") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp, state_file)


def update_state(last_checked_at: str = None, message_id: str = None,
                 date_processed: str = None, workspace_agent: str = None):
    """Update state after a successful run.

    Args:
        last_checked_at: ISO timestamp of this check (defaults to now)
        message_id: Graph API message ID of the digest just processed
        date_processed: Delivery date string (YYYY-MM-DD) just processed
    """
    if not workspace_agent:
        raise ValueError("workspace_agent is required")
    state = load_state(workspace_agent)

    state["last_checked_at"] = last_checked_at or datetime.utcnow().isoformat() + "Z"

    if message_id:
        state["last_message_id"] = message_id
        # Keep a rolling list of recently processed message IDs (dedup guard)
        recent = state.get("processed_message_ids", [])
        if message_id not in recent:
            recent.append(message_id)
        # Keep last 100
        state["processed_message_ids"] = recent[-100:]

    if date_processed:
        state["last_date_processed"] = date_processed

    save_state(state, workspace_agent)
