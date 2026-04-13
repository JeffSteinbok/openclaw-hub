#!/usr/bin/env python3
"""
USPS Mail Analyzer — OpenClaw plugin dispatch layer.

JSON stdin/stdout interface:
  {"method": "manifest"} → tool definitions
  {"method": "call", "tool": "...", "args": {...}} → tool result

Also works as a CLI:
  python tools.py --cli process --folder /tmp/usps-xxx
  python tools.py --cli lookup --search "amazon"
  python tools.py --cli rules --list
  python tools.py --cli stats
"""

import argparse
import json
import sys
from pathlib import Path


def _bootstrap_python_libs() -> None:
    anchor = Path(__file__).resolve()
    for base in anchor.parents:
        vendored_dir = base / "python"
        if vendored_dir.is_dir():
            vendored_str = str(vendored_dir)
            if vendored_str not in sys.path:
                sys.path.insert(0, vendored_str)
            return
    for base in anchor.parents:
        libs_dir = base / "libs" / "python"
        if libs_dir.is_dir() and (base / "package.json").is_file():
            libs_str = str(libs_dir)
            if libs_str not in sys.path:
                sys.path.insert(0, libs_str)
            return


_bootstrap_python_libs()

from repo_paths.bootstrap import bootstrap_repo_paths

BOOTSTRAP_PATHS = bootstrap_repo_paths(__file__)

from mail_action_usps.analyze import process_digest
from mail_action_usps.rules import add_rule, remove_rule, list_rules, test_rule, load_rules
from mail_action_usps.memory import lookup, get_stats, load_analysis, load_state


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------

def handle_process_digest(args: dict) -> dict:
    """Parse → vision → rules → memory → notify."""
    return process_digest(
        folder=args["folder"],
        analysis=args.get("analysis"),
        date=args.get("date"),
        dry_run=args.get("dry_run", False),
        vision_backend=args.get("vision_backend", "auto"),
        message_id=args.get("message_id"),
        workspace_agent=args["workspace_agent"],
        memory_agent=args.get("memory_agent"),
        vision_agent=args.get("vision_agent"),
    )


def handle_lookup(args: dict) -> dict:
    """Search past mailpieces by GUID, date, or text."""
    results = lookup(
        guid=args.get("guid"),
        date=args.get("date"),
        search=args.get("search"),
        workspace_agent=args["workspace_agent"],
    )
    return {
        "count": len(results),
        "results": [
            {
                "date": r[0],
                "image": r[1],
                "sender": r[2].get("sender", "Unknown"),
                "addressee": r[2].get("addressee", "Unknown"),
                "importance": r[2].get("importance", "unknown"),
                "description": r[2].get("description", ""),
                "guid": r[2].get("guid", "")[:8],
            }
            for r in results[:50]
        ],
    }


def handle_update_rule(args: dict) -> dict:
    """Add, remove, or test importance rules."""
    action = args.get("action", "add")

    if action == "add":
        conditions = args.get("conditions", {})
        importance = args.get("importance", "low")
        comment = args.get("comment", "")
        return add_rule(conditions, importance, comment, workspace_agent=args["workspace_agent"])

    elif action == "remove":
        return remove_rule(
            index=args.get("index"),
            comment_match=args.get("comment_match"),
            workspace_agent=args["workspace_agent"],
        )

    elif action == "test":
        info = args.get("mailpiece", {})
        return test_rule(info, workspace_agent=args["workspace_agent"])

    return {"error": f"Unknown action: {action}"}


def handle_rules(args: dict) -> dict:
    """List all rules or test a specific mailpiece against them."""
    if args.get("test_mailpiece"):
        return test_rule(args["test_mailpiece"], workspace_agent=args["workspace_agent"])
    return list_rules(workspace_agent=args["workspace_agent"])


def handle_stats(args: dict) -> dict:
    """Stats breakdown of analyzed mail."""
    return get_stats(workspace_agent=args["workspace_agent"])


def handle_status(args: dict) -> dict:
    """Return workflow state: last check time, last message ID, etc."""
    state = load_state(args["workspace_agent"])
    return {
        "last_checked_at": state.get("last_checked_at"),
        "last_message_id": state.get("last_message_id"),
        "last_date_processed": state.get("last_date_processed"),
        "processed_count": len(state.get("processed_message_ids", [])),
    }


# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------

TOOLS = {
    "usps_process_digest": {
        "description": "Process a USPS Informed Delivery digest folder and classify each mailpiece.",
        "input_schema": {
            "type": "object",
            "properties": {
                "folder": {
                    "type": "string",
                    "description": "Path to directory containing body.html and image files.",
                },
                "analysis": {
                    "type": "array",
                    "description": (
                        "Optional pre-computed analysis. Array of objects, one per image "
                        "(in filename sort order), each with: sender, addressee, description, "
                        "type, importance, mail_class, address_method."
                    ),
                    "items": {"type": "object"},
                },
                "date": {
                    "type": "string",
                    "description": "Override delivery date (YYYY-MM-DD). Auto-detected if omitted.",
                },
                "dry_run": {
                    "type": "boolean",
                    "description": "If true, skip sending notifications (print instead).",
                },
                "vision_backend": {
                    "type": "string",
                    "description": (
                        "'auto' (configured agent, default), 'provided' (use analysis arg), "
                        "'skip' (parsing only, no vision)."
                    ),
                    "enum": ["auto", "provided", "skip"],
                },
                "message_id": {
                    "type": "string",
                    "description": (
                        "Outlook Graph API message ID of this digest. Used for state "
                        "tracking and deduplication across runs."
                    ),
                },
                "workspace_agent": {
                    "type": "string",
                    "description": "Agent workspace that owns USPS rules, config, analysis history, and workflow state.",
                },
                "memory_agent": {
                    "type": "string",
                    "description": "Agent workspace that owns long-term mail memory markdown.",
                },
                "vision_agent": {
                    "type": "string",
                    "description": "Agent that performs USPS scan-image vision analysis. Required when vision_backend is auto.",
                },
            },
            "required": ["folder", "workspace_agent", "memory_agent"],
        },
        "handler": handle_process_digest,
    },
    "usps_lookup": {
        "description": "Search saved USPS mail history by GUID, date, or text.",
        "input_schema": {
            "type": "object",
            "properties": {
                "guid": {
                    "type": "string",
                    "description": "Partial GUID to match (first 8 chars is typical).",
                },
                "date": {
                    "type": "string",
                    "description": "Date or partial date to match (YYYY-MM-DD or YYYY-MM).",
                },
                "search": {
                    "type": "string",
                    "description": "Text to search for in any field.",
                },
                "workspace_agent": {
                    "type": "string",
                    "description": "Agent workspace that owns USPS rules, config, analysis history, and workflow state.",
                },
            },
            "required": ["workspace_agent"],
        },
        "handler": handle_lookup,
    },
    "usps_update_rule": {
        "description": "Add, remove, or test USPS mail classification rules.",
        "input_schema": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "description": "What to do.",
                    "enum": ["add", "remove", "test"],
                },
                "conditions": {
                    "type": "object",
                    "description": (
                        "Rule conditions (for 'add'). Keys like sender_contains, "
                        "addressee_contains, description_not_contains, etc."
                    ),
                },
                "importance": {
                    "type": "string",
                    "description": "Target importance level (for 'add').",
                    "enum": ["urgent", "high", "medium", "low", "junk", "ad"],
                },
                "comment": {
                    "type": "string",
                    "description": "Human-readable description of the rule (for 'add').",
                },
                "index": {
                    "type": "integer",
                    "description": "Rule index to remove (for 'remove').",
                },
                "comment_match": {
                    "type": "string",
                    "description": "Remove rule whose comment contains this text (for 'remove').",
                },
                "mailpiece": {
                    "type": "object",
                    "description": "Mailpiece info dict to test against rules (for 'test').",
                },
                "workspace_agent": {
                    "type": "string",
                    "description": "Agent workspace that owns USPS rules, config, analysis history, and workflow state.",
                },
            },
            "required": ["action", "workspace_agent"],
        },
        "handler": handle_update_rule,
    },
    "usps_rules": {
        "description": "List USPS classification rules or test a sample mailpiece.",
        "input_schema": {
            "type": "object",
            "properties": {
                "test_mailpiece": {
                    "type": "object",
                    "description": (
                        "Optional mailpiece to test. Provide sender, addressee, etc. "
                        "Returns which rule matches and the resulting importance."
                    ),
                },
                "workspace_agent": {
                    "type": "string",
                    "description": "Agent workspace that owns USPS rules, config, analysis history, and workflow state.",
                },
            },
            "required": ["workspace_agent"],
        },
        "handler": handle_rules,
    },
    "usps_stats": {
        "description": "Show summary statistics for processed USPS mail.",
        "input_schema": {
            "type": "object",
            "properties": {
                "workspace_agent": {
                    "type": "string",
                    "description": "Agent workspace that owns USPS rules, config, analysis history, and workflow state.",
                },
            },
            "required": ["workspace_agent"],
        },
        "handler": handle_stats,
    },
    "usps_status": {
        "description": "Show the current USPS mail workflow state.",
        "input_schema": {
            "type": "object",
            "properties": {
                "workspace_agent": {
                    "type": "string",
                    "description": "Agent workspace that owns USPS rules, config, analysis history, and workflow state.",
                },
            },
            "required": ["workspace_agent"],
        },
        "handler": handle_status,
    },
}


# ---------------------------------------------------------------------------
# JSON stdin/stdout dispatch (plugin mode)
# ---------------------------------------------------------------------------

def manifest():
    return {
        "tools": [
            {
                "name": name,
                "description": tool["description"],
                "input_schema": tool["input_schema"],
            }
            for name, tool in TOOLS.items()
        ]
    }


def call(tool_name: str, args: dict):
    if tool_name not in TOOLS:
        return {"error": f"Unknown tool: {tool_name}"}
    return TOOLS[tool_name]["handler"](args)


# ---------------------------------------------------------------------------
# CLI mode (offline testing)
# ---------------------------------------------------------------------------

def cli_main():
    parser = argparse.ArgumentParser(
        description="USPS Mail Analyzer — offline CLI"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # process
    p_proc = sub.add_parser("process", help="Process a digest folder")
    p_proc.add_argument("--folder", required=True, help="Folder with body.html + images")
    p_proc.add_argument("--date", help="Override date (YYYY-MM-DD)")
    p_proc.add_argument("--dry-run", action="store_true", help="Skip notifications")
    p_proc.add_argument("--vision", choices=["auto", "skip"], default="auto")
    p_proc.add_argument("--analysis-json", help="Path to JSON file with pre-computed analysis")
    p_proc.add_argument("--workspace-agent", required=True, help="Agent workspace owning USPS data")
    p_proc.add_argument("--memory-agent", required=True, help="Agent workspace owning long-term mail memory")
    p_proc.add_argument("--vision-agent", required=True, help="Agent performing USPS scan-image vision analysis")

    # lookup
    p_look = sub.add_parser("lookup", help="Search past mail")
    p_look.add_argument("--guid", help="Partial GUID")
    p_look.add_argument("--date", help="Date or month (YYYY-MM-DD or YYYY-MM)")
    p_look.add_argument("--search", help="Text search across all fields")
    p_look.add_argument("--workspace-agent", required=True, help="Agent workspace owning USPS data")

    # rules
    p_rules = sub.add_parser("rules", help="Manage rules")
    p_rules.add_argument("--list", action="store_true", help="List all rules")
    p_rules.add_argument("--add-json", help="JSON string with {conditions, importance, comment}")
    p_rules.add_argument("--remove-index", type=int, help="Remove rule at index")
    p_rules.add_argument("--workspace-agent", required=True, help="Agent workspace owning USPS data")

    # stats
    p_stats = sub.add_parser("stats", help="Show statistics")
    p_stats.add_argument("--workspace-agent", required=True, help="Agent workspace owning USPS data")

    args = parser.parse_args(sys.argv[2:])  # skip --cli

    if args.command == "process":
        analysis = None
        if args.analysis_json:
            with open(args.analysis_json) as f:
                analysis = json.load(f)
        result = process_digest(
            folder=args.folder,
            analysis=analysis,
            date=args.date,
            dry_run=args.dry_run,
            vision_backend="provided" if analysis else args.vision,
            workspace_agent=args.workspace_agent,
            memory_agent=args.memory_agent,
            vision_agent=args.vision_agent,
        )
    elif args.command == "lookup":
        result = handle_lookup({
            "guid": args.guid,
            "date": args.date,
            "search": args.search,
            "workspace_agent": args.workspace_agent,
        })
    elif args.command == "rules":
        if args.add_json:
            data = json.loads(args.add_json)
            result = add_rule(data["conditions"], data["importance"], data.get("comment", ""), workspace_agent=args.workspace_agent)
        elif args.remove_index is not None:
            result = remove_rule(index=args.remove_index, workspace_agent=args.workspace_agent)
        else:
            result = list_rules(workspace_agent=args.workspace_agent)
    elif args.command == "stats":
        result = handle_stats({"workspace_agent": args.workspace_agent})
    else:
        result = {"error": f"Unknown command: {args.command}"}

    print(json.dumps(result, indent=2))


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--cli":
        cli_main()
        return

    payload = json.load(sys.stdin)
    method = payload["method"]

    if method == "manifest":
        print(json.dumps(manifest()))
    elif method == "call":
        result = call(payload["tool"], payload.get("args", {}))
        print(json.dumps(result))
    else:
        print(json.dumps({"error": f"Unknown method: {method}"}))


if __name__ == "__main__":
    main()
