"""GitHub plugin tools — create issues on GitHub as the OpenClaw user."""

import json
import os
import sys

# Ensure sibling modules are importable when run directly
sys.path.insert(0, os.path.dirname(__file__))

from github_client import (
    create_issue,
    get_issue,
    edit_issue,
    close_issue,
    reopen_issue,
    comment_issue,
    list_issues,
)


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


def handle_create_issue(args: dict) -> dict:
    """Create a GitHub issue."""
    owner = args.get("owner", "").strip()
    repo = args.get("repo", "").strip()
    title = args.get("title", "").strip()

    if not owner or not repo or not title:
        return {"error": "owner, repo, and title are required"}

    body = args.get("body", "")
    labels = args.get("labels") or []
    assignees = args.get("assignees") or []
    milestone = args.get("milestone")

    return create_issue(
        owner=owner,
        repo=repo,
        title=title,
        body=body,
        labels=labels if labels else None,
        assignees=assignees if assignees else None,
        milestone=milestone,
    )


def handle_get_issue(args: dict) -> dict:
    """Get a GitHub issue by number."""
    owner = args.get("owner", "").strip()
    repo = args.get("repo", "").strip()
    issue_number = args.get("issue_number")

    if not owner or not repo or not issue_number:
        return {"error": "owner, repo, and issue_number are required"}

    return get_issue(owner=owner, repo=repo, issue_number=issue_number)


def handle_edit_issue(args: dict) -> dict:
    """Edit a GitHub issue."""
    owner = args.get("owner", "").strip()
    repo = args.get("repo", "").strip()
    issue_number = args.get("issue_number")

    if not owner or not repo or not issue_number:
        return {"error": "owner, repo, and issue_number are required"}

    # At least one field to update must be provided
    has_update = any(
        key in args
        for key in ["title", "body", "state", "labels", "assignees", "milestone"]
    )
    if not has_update:
        return {"error": "At least one field to update is required"}

    return edit_issue(
        owner=owner,
        repo=repo,
        issue_number=issue_number,
        title=args.get("title"),
        body=args.get("body"),
        state=args.get("state"),
        labels=args.get("labels"),
        assignees=args.get("assignees"),
        milestone=args.get("milestone"),
    )


def handle_close_issue(args: dict) -> dict:
    """Close a GitHub issue."""
    owner = args.get("owner", "").strip()
    repo = args.get("repo", "").strip()
    issue_number = args.get("issue_number")
    reopen = args.get("reopen", False)

    if not owner or not repo or not issue_number:
        return {"error": "owner, repo, and issue_number are required"}

    if reopen:
        return reopen_issue(owner=owner, repo=repo, issue_number=issue_number)
    return close_issue(owner=owner, repo=repo, issue_number=issue_number)


def handle_comment_issue(args: dict) -> dict:
    """Add a comment to a GitHub issue."""
    owner = args.get("owner", "").strip()
    repo = args.get("repo", "").strip()
    issue_number = args.get("issue_number")
    body = args.get("body", "").strip()

    if not owner or not repo or not issue_number:
        return {"error": "owner, repo, and issue_number are required"}
    if not body:
        return {"error": "body is required"}

    return comment_issue(owner=owner, repo=repo, issue_number=issue_number, body=body)


def handle_list_issues(args: dict) -> dict:
    """List GitHub issues."""
    owner = args.get("owner", "").strip()
    repo = args.get("repo", "").strip()

    if not owner or not repo:
        return {"error": "owner and repo are required"}

    return list_issues(
        owner=owner,
        repo=repo,
        state=args.get("state", "open"),
        labels=args.get("labels"),
        assignee=args.get("assignee"),
        milestone=args.get("milestone"),
        per_page=args.get("per_page", 30),
        page=args.get("page", 1),
    )


# ---------------------------------------------------------------------------
# Standard plugin dispatch
# ---------------------------------------------------------------------------

TOOLS = {
    "github_create_issue": {
        "description": (
            "Create a new issue in a GitHub repository. "
            "Acts as the authenticated OpenClaw user (GITHUB_TOKEN). "
            "Returns the issue number, URL, and state."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "owner": {
                    "type": "string",
                    "description": "Repository owner (user or organisation name)",
                },
                "repo": {
                    "type": "string",
                    "description": "Repository name",
                },
                "title": {
                    "type": "string",
                    "description": "Issue title",
                },
                "body": {
                    "type": "string",
                    "description": "Issue body (Markdown supported). Defaults to empty string.",
                },
                "labels": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Labels to apply to the issue (must already exist in the repo)",
                },
                "assignees": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "GitHub usernames to assign the issue to",
                },
                "milestone": {
                    "type": "integer",
                    "description": "Milestone number to associate with the issue",
                },
            },
            "required": ["owner", "repo", "title"],
            "additionalProperties": False,
        },
        "handler": handle_create_issue,
    },
    "github_get_issue": {
        "description": (
            "Get a single GitHub issue by its number. "
            "Returns issue details including title, body, state, labels, and assignees."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "owner": {
                    "type": "string",
                    "description": "Repository owner (user or organisation name)",
                },
                "repo": {
                    "type": "string",
                    "description": "Repository name",
                },
                "issue_number": {
                    "type": "integer",
                    "description": "Issue number",
                },
            },
            "required": ["owner", "repo", "issue_number"],
            "additionalProperties": False,
        },
        "handler": handle_get_issue,
    },
    "github_edit_issue": {
        "description": (
            "Edit an existing GitHub issue. "
            "Update title, body, state, labels, assignees, or milestone. "
            "At least one field to update must be provided."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "owner": {
                    "type": "string",
                    "description": "Repository owner (user or organisation name)",
                },
                "repo": {
                    "type": "string",
                    "description": "Repository name",
                },
                "issue_number": {
                    "type": "integer",
                    "description": "Issue number",
                },
                "title": {
                    "type": "string",
                    "description": "New issue title",
                },
                "body": {
                    "type": "string",
                    "description": "New issue body (Markdown supported)",
                },
                "state": {
                    "type": "string",
                    "enum": ["open", "closed"],
                    "description": "Issue state (open or closed)",
                },
                "labels": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Labels to apply (replaces existing labels)",
                },
                "assignees": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Assignees (replaces existing assignees)",
                },
                "milestone": {
                    "type": "integer",
                    "description": "Milestone number",
                },
            },
            "required": ["owner", "repo", "issue_number"],
            "additionalProperties": False,
        },
        "handler": handle_edit_issue,
    },
    "github_close_issue": {
        "description": (
            "Close or reopen a GitHub issue. "
            "By default closes the issue, set reopen=true to reopen it."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "owner": {
                    "type": "string",
                    "description": "Repository owner (user or organisation name)",
                },
                "repo": {
                    "type": "string",
                    "description": "Repository name",
                },
                "issue_number": {
                    "type": "integer",
                    "description": "Issue number",
                },
                "reopen": {
                    "type": "boolean",
                    "description": "Set to true to reopen the issue instead of closing it",
                },
            },
            "required": ["owner", "repo", "issue_number"],
            "additionalProperties": False,
        },
        "handler": handle_close_issue,
    },
    "github_comment_issue": {
        "description": (
            "Add a comment to a GitHub issue. "
            "Returns the comment ID, body, user, and URL."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "owner": {
                    "type": "string",
                    "description": "Repository owner (user or organisation name)",
                },
                "repo": {
                    "type": "string",
                    "description": "Repository name",
                },
                "issue_number": {
                    "type": "integer",
                    "description": "Issue number",
                },
                "body": {
                    "type": "string",
                    "description": "Comment body (Markdown supported)",
                },
            },
            "required": ["owner", "repo", "issue_number", "body"],
            "additionalProperties": False,
        },
        "handler": handle_comment_issue,
    },
    "github_list_issues": {
        "description": (
            "List GitHub issues with optional filters. "
            "Filter by state (open/closed/all), labels, assignee, and milestone. "
            "Returns a list of issues and the total count."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "owner": {
                    "type": "string",
                    "description": "Repository owner (user or organisation name)",
                },
                "repo": {
                    "type": "string",
                    "description": "Repository name",
                },
                "state": {
                    "type": "string",
                    "enum": ["open", "closed", "all"],
                    "description": "Filter by state (default: open)",
                },
                "labels": {
                    "type": "string",
                    "description": "Comma-separated list of labels to filter by",
                },
                "assignee": {
                    "type": "string",
                    "description": "Filter by assignee username",
                },
                "milestone": {
                    "type": "string",
                    "description": "Filter by milestone number or '*' for any milestone",
                },
                "per_page": {
                    "type": "integer",
                    "description": "Results per page (default: 30, max: 100)",
                },
                "page": {
                    "type": "integer",
                    "description": "Page number for pagination (default: 1)",
                },
            },
            "required": ["owner", "repo"],
            "additionalProperties": False,
        },
        "handler": handle_list_issues,
    },
}


def manifest() -> dict:
    return {
        "tools": [
            {
                "name": name,
                "description": info["description"],
                "input_schema": info["input_schema"],
            }
            for name, info in TOOLS.items()
        ]
    }


def call(tool: str, args: dict):
    if tool not in TOOLS:
        return {"error": f"Unknown tool: {tool}"}
    return TOOLS[tool]["handler"](args)


def main():
    payload = json.load(sys.stdin)
    method = payload["method"]
    if method == "manifest":
        print(json.dumps(manifest()))
    elif method == "call":
        print(json.dumps(call(payload["tool"], payload.get("args", {}))))


if __name__ == "__main__":
    main()
