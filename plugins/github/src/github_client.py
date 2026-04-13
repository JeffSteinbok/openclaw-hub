#!/usr/bin/env python3
"""
GitHub REST API client for OpenClaw.

Auth: GITHUB_TOKEN env var (personal access token or fine-grained token).
"""

import json
import os
import sys
import urllib.error
import urllib.request

GITHUB_API_BASE = "https://api.github.com"


def _get_token() -> str:
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if not token:
        print("ERROR: GITHUB_TOKEN not set.", file=sys.stderr)
        sys.exit(1)
    return token


def _api_request(method: str, path: str, body: dict | None = None) -> dict:
    """Make an authenticated GitHub API request and return the parsed JSON response."""
    token = _get_token()
    url = f"{GITHUB_API_BASE}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode(errors="replace")[:500]
        return {"error": f"HTTP {exc.code}: {body_text}"}


def create_issue(
    owner: str,
    repo: str,
    title: str,
    body: str = "",
    labels: list[str] | None = None,
    assignees: list[str] | None = None,
    milestone: int | None = None,
) -> dict:
    """Create a GitHub issue and return the API response."""
    payload: dict = {"title": title, "body": body}
    if labels:
        payload["labels"] = labels
    if assignees:
        payload["assignees"] = assignees
    if milestone is not None:
        payload["milestone"] = milestone

    result = _api_request("POST", f"/repos/{owner}/{repo}/issues", payload)
    if "error" in result:
        return result

    return _format_issue_response(result)


def get_issue(owner: str, repo: str, issue_number: int) -> dict:
    """Get a single GitHub issue by number."""
    result = _api_request("GET", f"/repos/{owner}/{repo}/issues/{issue_number}")
    if "error" in result:
        return result
    return _format_issue_response(result)


def edit_issue(
    owner: str,
    repo: str,
    issue_number: int,
    title: str | None = None,
    body: str | None = None,
    state: str | None = None,
    labels: list[str] | None = None,
    assignees: list[str] | None = None,
    milestone: int | None = None,
) -> dict:
    """Edit a GitHub issue and return the updated issue."""
    payload: dict = {}
    if title is not None:
        payload["title"] = title
    if body is not None:
        payload["body"] = body
    if state is not None:
        payload["state"] = state
    if labels is not None:
        payload["labels"] = labels
    if assignees is not None:
        payload["assignees"] = assignees
    if milestone is not None:
        payload["milestone"] = milestone

    result = _api_request("PATCH", f"/repos/{owner}/{repo}/issues/{issue_number}", payload)
    if "error" in result:
        return result
    return _format_issue_response(result)


def close_issue(owner: str, repo: str, issue_number: int) -> dict:
    """Close a GitHub issue."""
    return edit_issue(owner, repo, issue_number, state="closed")


def reopen_issue(owner: str, repo: str, issue_number: int) -> dict:
    """Reopen a GitHub issue."""
    return edit_issue(owner, repo, issue_number, state="open")


def comment_issue(owner: str, repo: str, issue_number: int, body: str) -> dict:
    """Add a comment to a GitHub issue."""
    payload = {"body": body}
    result = _api_request("POST", f"/repos/{owner}/{repo}/issues/{issue_number}/comments", payload)
    if "error" in result:
        return result

    return {
        "id": result.get("id"),
        "body": result.get("body"),
        "user": result.get("user", {}).get("login"),
        "created_at": result.get("created_at"),
        "url": result.get("html_url"),
    }


def list_issues(
    owner: str,
    repo: str,
    state: str = "open",
    labels: str | None = None,
    assignee: str | None = None,
    milestone: str | None = None,
    per_page: int = 30,
    page: int = 1,
) -> dict:
    """List GitHub issues with optional filters."""
    import urllib.parse

    # Build query parameters
    params = [("state", state), ("per_page", per_page), ("page", page)]
    if labels:
        params.append(("labels", labels))
    if assignee:
        params.append(("assignee", assignee))
    if milestone:
        params.append(("milestone", milestone))

    query_string = urllib.parse.urlencode(params)
    result = _api_request("GET", f"/repos/{owner}/{repo}/issues?{query_string}")
    if "error" in result:
        return result

    # GitHub API returns issues as an array, but also includes PRs
    # Filter out PRs (they have a "pull_request" key)
    issues = [issue for issue in result if "pull_request" not in issue]

    return {
        "issues": [_format_issue_response(issue) for issue in issues],
        "count": len(issues),
    }


def _format_issue_response(result: dict) -> dict:
    """Format a GitHub issue response to a consistent structure."""
    return {
        "number": result.get("number"),
        "title": result.get("title"),
        "url": result.get("html_url"),
        "state": result.get("state"),
        "created_at": result.get("created_at"),
        "labels": [lbl.get("name") for lbl in result.get("labels", [])],
        "assignees": [a.get("login") for a in result.get("assignees", [])],
    }
