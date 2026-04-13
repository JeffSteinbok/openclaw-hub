#!/usr/bin/env python3
"""
Importance rule engine for USPS mail classification.

Rules are loaded from a versioned JSON file stored in the mail agent workspace
(~/.openclaw/agents/mail/workspace/usps-mail/rules.json). The plugin ships with no
built-in rules — all rules are personal and user-managed.

Rule format:
{
  "version": "1.2",
  "rules": [
    {
      "_comment": "Former residents: Conway → low",
      "addressee_contains": "conway",
      "importance": "low"
    }
  ]
}

Supported conditions (all case-insensitive):
  <field>_contains, <field>_not_contains,
  <field>_equals, <field>_not_equals

Fields: addressee, sender, description, mail_class, address_method
"""

import json
import os

from .paths import get_rules_file

BADGE_LABELS = {
    "urgent": "🚨 Urgent",
    "high": "⚠️ Important",
    "medium": "📬 Medium",
    "low": "📭 Low",
    "junk": "🗑️ Junk",
    "ad": "📢 Ad",
    "unknown": "❓ Unknown",
}


def load_rules(rules_path: str = None, workspace_agent: str = None) -> tuple:
    """Load rules from JSON. Returns (rules_list, version_str)."""
    if not rules_path and not workspace_agent:
        raise ValueError("workspace_agent is required when rules_path is not provided")
    path = rules_path or str(get_rules_file(workspace_agent))
    if not os.path.exists(path):
        return [], "0"
    with open(path) as f:
        data = json.load(f)
    if isinstance(data, dict):
        return data.get("rules", []), str(data.get("version", "0"))
    return data, "0"


def save_rules(rules: list, version: str, rules_path: str = None, workspace_agent: str = None):
    """Atomic write of rules to disk."""
    path = rules_path or str(get_rules_file(workspace_agent))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"version": version, "rules": rules}, f, indent=2)
    os.replace(tmp, path)


def apply_rules(info: dict, rules: list = None) -> dict:
    """Apply importance override rules to a mailpiece info dict.

    First matching rule wins. Returns a (possibly modified) copy of info.
    """
    if rules is None:
        rules, _ = load_rules()
    if not rules:
        return info

    addressee = info.get("addressee", "").lower()
    sender = info.get("sender", "").lower()
    description = info.get("description", "").lower()
    mail_class = info.get("mail_class", "").lower()
    address_method = info.get("address_method", "").lower()

    fields = {
        "addressee": addressee,
        "sender": sender,
        "description": description,
        "mail_class": mail_class,
        "address_method": address_method,
    }

    for rule in rules:
        match = True
        for key, val in rule.items():
            if key in ("_comment", "importance"):
                continue

            if key.endswith("_not_contains"):
                field_name = key[: -len("_not_contains")]
                if val.lower() in fields.get(field_name, ""):
                    match = False
            elif key.endswith("_contains"):
                field_name = key[: -len("_contains")]
                if val.lower() not in fields.get(field_name, ""):
                    match = False
            elif key.endswith("_not_equals"):
                field_name = key[: -len("_not_equals")]
                if val.lower() == fields.get(field_name, ""):
                    match = False
            elif key.endswith("_equals"):
                field_name = key[: -len("_equals")]
                if val.lower() != fields.get(field_name, ""):
                    match = False

        if match:
            info = dict(info)
            info["importance"] = rule["importance"]
            return info

    return info


def add_rule(conditions: dict, importance: str, comment: str = "", workspace_agent: str = None) -> dict:
    """Add a new rule and bump version. Returns updated rule summary."""
    if not workspace_agent:
        raise ValueError("workspace_agent is required")
    rules, version = load_rules(workspace_agent=workspace_agent)
    new_rule = dict(conditions)
    new_rule["importance"] = importance
    if comment:
        new_rule["_comment"] = comment

    rules.append(new_rule)

    # Bump version
    try:
        major, minor = version.split(".")
        new_version = f"{major}.{int(minor) + 1}"
    except ValueError:
        new_version = f"{version}.1" if version != "0" else "1.0"

    save_rules(rules, new_version, workspace_agent=workspace_agent)
    return {"action": "added", "rule_index": len(rules) - 1, "version": new_version}


def remove_rule(index: int = None, comment_match: str = None, workspace_agent: str = None) -> dict:
    """Remove a rule by index or comment substring. Returns result."""
    if not workspace_agent:
        raise ValueError("workspace_agent is required")
    rules, version = load_rules(workspace_agent=workspace_agent)

    removed = None
    if index is not None and 0 <= index < len(rules):
        removed = rules.pop(index)
    elif comment_match:
        for i, rule in enumerate(rules):
            if comment_match.lower() in rule.get("_comment", "").lower():
                removed = rules.pop(i)
                break

    if removed is None:
        return {"action": "not_found"}

    try:
        major, minor = version.split(".")
        new_version = f"{major}.{int(minor) + 1}"
    except ValueError:
        new_version = f"{version}.1"

    save_rules(rules, new_version, workspace_agent=workspace_agent)
    return {"action": "removed", "rule": removed, "version": new_version}


def test_rule(info: dict, workspace_agent: str = None) -> dict:
    """Test which rule matches a given mailpiece. Returns match details."""
    if not workspace_agent:
        raise ValueError("workspace_agent is required")
    rules, version = load_rules(workspace_agent=workspace_agent)
    result = apply_rules(info, rules)
    original_imp = info.get("importance", "unknown")
    new_imp = result.get("importance", original_imp)

    return {
        "original_importance": original_imp,
        "final_importance": new_imp,
        "rule_matched": original_imp != new_imp,
        "rules_version": version,
    }


def list_rules(workspace_agent: str = None) -> dict:
    """List all rules with version."""
    if not workspace_agent:
        raise ValueError("workspace_agent is required")
    rules, version = load_rules(workspace_agent=workspace_agent)
    summary = []
    for i, rule in enumerate(rules):
        conditions = {k: v for k, v in rule.items() if k not in ("_comment", "importance")}
        summary.append({
            "index": i,
            "comment": rule.get("_comment", ""),
            "importance": rule.get("importance", "?"),
            "conditions": conditions,
        })
    return {"version": version, "count": len(rules), "rules": summary}
