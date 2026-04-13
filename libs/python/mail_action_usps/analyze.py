#!/usr/bin/env python3
"""
Main USPS mail analysis pipeline.

Flow: folder → parse HTML → vision-analyze images → apply rules → optional memory → notify

    Two modes:
      - auto:     vision analysis done via an explicit OpenClaw agent (production)
      - provided: caller supplies analysis array (Copilot inline / testing)
"""

import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

from .parse_digest import parse_digest_html
from .vision import analyze_via_agent, validate_analysis
from .rules import apply_rules, load_rules
from .memory import make_guid, save_to_analysis, write_memory_for_date, update_state
from .notify import build_notification_plan, route_and_notify


def _detect_date_from_html(html_path: str) -> str:
    """Try to extract the delivery date from the digest HTML.
    Falls back to today's date."""
    try:
        with open(html_path, errors="replace") as f:
            html = f.read()
        # Pattern like "June 25, 2025" or "Saturday, June 25, 2025"
        m = re.search(
            r"(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*"
            r"(\w+ \d{1,2},?\s*\d{4})", html
        )
        if m:
            cleaned = m.group(1).replace(",", "")
            dt = datetime.strptime(cleaned, "%B %d %Y")
            return dt.strftime("%Y-%m-%d")
        # ISO-ish fallback
        m = re.search(r"(20\d{2}-\d{2}-\d{2})", html)
        if m:
            return m.group(1)
    except Exception:
        pass
    return datetime.now().strftime("%Y-%m-%d")


def _list_scan_images(folder: Path) -> list:
    """Find scan images in the folder (*.jpg, skip known non-scan patterns)."""
    images = []
    for f in sorted(folder.iterdir()):
        if f.suffix.lower() not in (".jpg", ".jpeg", ".png"):
            continue
        if f.name.startswith("content-") or f.name == "body.html":
            continue
        images.append(f)
    return images


def process_digest(
    folder: str,
    analysis: list = None,
    date: str = None,
    dry_run: bool = False,
    vision_backend: str = "auto",
    message_id: str = None,
    persist_analysis: bool = True,
    write_memory: bool = True,
    send_notifications: bool = True,
    update_workflow_state: bool = True,
    workspace_agent: str = None,
    memory_agent: str = None,
    vision_agent: str = None,
) -> dict:
    """
    Process a single USPS digest.

    Args:
        folder: Path to directory containing body.html + image files
        analysis: Optional list of pre-computed analysis dicts (one per image).
                  Keys: sender, addressee, description, type, importance, mail_class
        date: Override delivery date (YYYY-MM-DD). Auto-detected from HTML if omitted.
        dry_run: If True, skip notifications (print instead)
        vision_backend: "auto" (configured agent), "provided" (use analysis arg), "skip" (parsing only)
        message_id: Outlook Graph API message ID (for state tracking / dedup)
        persist_analysis: If True, merge results into analysis history
        write_memory: If True, append a monthly mail memory entry
        send_notifications: If True, deliver routed notifications
        update_workflow_state: If True, update workflow state after success
        workspace_agent: Agent workspace that owns USPS rules/state/config/cache
        memory_agent: Agent workspace that owns long-term mail memory markdown
        vision_agent: Agent that performs USPS scan-image vision analysis

    Returns:
        Summary dict with date, items, notifications, etc.
    """
    if not workspace_agent:
        raise ValueError("workspace_agent is required")
    if write_memory and not memory_agent:
        raise ValueError("memory_agent is required when write_memory is enabled")
    if analysis is None and vision_backend == "auto" and not vision_agent:
        raise ValueError("vision_agent is required when vision_backend is auto")

    folder_path = Path(folder)
    body_html = folder_path / "body.html"

    if not body_html.exists():
        return {"error": f"No body.html found in {folder}"}

    # Parse the digest HTML
    parsed = parse_digest_html(str(body_html))
    date_str = date or _detect_date_from_html(str(body_html))

    # Find scan images
    scan_images = _list_scan_images(folder_path)

    # Build analysis for each image
    items = {}
    rules, rules_version = load_rules(workspace_agent=workspace_agent)

    if analysis is not None:
        # Provided mode: use supplied analysis (Copilot inline / testing)
        for i, img in enumerate(scan_images):
            if i < len(analysis):
                info = validate_analysis(analysis[i])
            else:
                info = validate_analysis({})
            info["guid"] = make_guid(date_str, img.name)
            info["rules_version"] = rules_version
            info["vision_backend"] = "provided"
            info = apply_rules(info, rules)
            items[img.name] = info

    elif vision_backend == "skip":
        # Parsing only — no vision analysis
        for img in scan_images:
            items[img.name] = {
                "sender": "Unknown",
                "addressee": "Unknown",
                "description": "Vision analysis skipped",
                "type": "scan",
                "importance": "unknown",
                "mail_class": "Unknown",
                "address_method": "",
                "guid": make_guid(date_str, img.name),
                "rules_version": rules_version,
                "vision_backend": "skip",
            }

    else:
        # Auto mode: use openclaw agent vision
        for img in scan_images:
            print(f"  Analyzing {img.name}...", file=sys.stderr)
            try:
                raw = analyze_via_agent(str(img), vision_agent=vision_agent)
                info = validate_analysis(raw)
            except Exception as e:
                print(f"  ⚠ Vision failed for {img.name}: {e}", file=sys.stderr)
                info = validate_analysis({})
                info["description"] = f"Vision analysis failed: {str(e)[:100]}"

            info["guid"] = make_guid(date_str, img.name)
            info["rules_version"] = rules_version
            info["vision_backend"] = "openclaw_agent"
            info = apply_rules(info, rules)
            items[img.name] = info

    # Persist analysis
    if persist_analysis:
        save_to_analysis(date_str, items, workspace_agent=workspace_agent)

    # Write memory markdown
    memory_items = [
        {**info, "image": fname}
        for fname, info in items.items()
    ]
    memory_path = None
    if write_memory:
        memory_path = write_memory_for_date(date_str, memory_items, memory_agent=memory_agent)

    notification_plan = build_notification_plan(date_str, list(items.values()), workspace_agent=workspace_agent)
    notifications = []
    if send_notifications:
        notifications = route_and_notify(date_str, list(items.values()), dry_run=dry_run, workspace_agent=workspace_agent)

    # Update workflow state (last checked, message ID for dedup)
    if update_workflow_state and not dry_run:
        update_state(
            message_id=message_id,
            date_processed=date_str,
            workspace_agent=workspace_agent,
        )

    # Summary
    imp_counts = {}
    for info in items.values():
        imp = info.get("importance", "unknown")
        imp_counts[imp] = imp_counts.get(imp, 0) + 1

    return {
        "date": date_str,
        "mail_count": parsed.get("mail_count", 0),
        "images_analyzed": len(items),
        "importance_breakdown": imp_counts,
        "structured_items": [
            {
                "image": fname,
                **info,
            }
            for fname, info in items.items()
        ],
        "items": [
            {
                "image": fname,
                "sender": info.get("sender", "Unknown"),
                "addressee": info.get("addressee", "Unknown"),
                "importance": info.get("importance", "unknown"),
                "description": info.get("description", ""),
                "guid": info.get("guid", "")[:8],
            }
            for fname, info in items.items()
        ],
        "notification_plan": notification_plan,
        "notifications_sent": len(notifications),
        "notification_details": notifications,
        "memory_file": memory_path,
        "analysis_saved": persist_analysis,
        "memory_written": bool(memory_path),
    }
