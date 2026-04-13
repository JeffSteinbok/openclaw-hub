"""Unit tests for the GitHub issue tools (no network access required)."""

import json
import sys
import os
import unittest
from unittest.mock import MagicMock, patch

# Add src dir to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from tools import (
    manifest,
    call,
    handle_get_issue,
    handle_edit_issue,
    handle_close_issue,
    handle_comment_issue,
    handle_list_issues,
)


class TestManifestIssueTools(unittest.TestCase):
    """Verify all issue tools are in the manifest."""

    def test_manifest_has_all_issue_tools(self):
        m = manifest()
        names = [t["name"] for t in m["tools"]]
        expected_tools = [
            "github_create_issue",
            "github_get_issue",
            "github_edit_issue",
            "github_close_issue",
            "github_comment_issue",
            "github_list_issues",
        ]
        for tool in expected_tools:
            self.assertIn(tool, names, f"{tool} should be in manifest")

    def test_manifest_does_not_have_pr_or_release_tools(self):
        m = manifest()
        names = [t["name"] for t in m["tools"]]
        forbidden_tools = [
            "github_get_pr",
            "github_list_prs",
            "github_comment_pr",
            "github_merge_pr",
            "github_list_releases",
            "github_create_release",
        ]
        for tool in forbidden_tools:
            self.assertNotIn(tool, names, f"{tool} should not be in manifest")


class TestHandleGetIssue(unittest.TestCase):
    """Test getting a single issue."""

    @patch("github_client._api_request")
    def test_get_issue_success(self, mock_api):
        mock_api.return_value = {
            "number": 42,
            "title": "Bug report",
            "html_url": "https://github.com/owner/repo/issues/42",
            "state": "open",
            "created_at": "2026-03-13T00:00:00Z",
            "labels": [{"name": "bug"}],
            "assignees": [{"login": "alice"}],
        }
        result = handle_get_issue({"owner": "owner", "repo": "repo", "issue_number": 42})
        self.assertEqual(result["number"], 42)
        self.assertEqual(result["title"], "Bug report")
        mock_api.assert_called_once_with("GET", "/repos/owner/repo/issues/42")

    def test_get_issue_missing_params(self):
        result = handle_get_issue({"owner": "owner", "repo": "repo"})
        self.assertIn("error", result)


class TestHandleEditIssue(unittest.TestCase):
    """Test editing an issue."""

    @patch("github_client._api_request")
    def test_edit_issue_title_only(self, mock_api):
        mock_api.return_value = {
            "number": 1,
            "title": "New Title",
            "html_url": "https://github.com/o/r/issues/1",
            "state": "open",
            "created_at": "2026-03-13T00:00:00Z",
            "labels": [],
            "assignees": [],
        }
        result = handle_edit_issue({
            "owner": "o",
            "repo": "r",
            "issue_number": 1,
            "title": "New Title",
        })
        self.assertNotIn("error", result)
        self.assertEqual(result["title"], "New Title")
        call_args = mock_api.call_args
        self.assertEqual(call_args[0][0], "PATCH")
        self.assertEqual(call_args[0][1], "/repos/o/r/issues/1")
        self.assertEqual(call_args[0][2]["title"], "New Title")

    @patch("github_client._api_request")
    def test_edit_issue_multiple_fields(self, mock_api):
        mock_api.return_value = {
            "number": 2,
            "title": "Updated",
            "html_url": "https://github.com/o/r/issues/2",
            "state": "closed",
            "created_at": "2026-03-13T00:00:00Z",
            "labels": [{"name": "wontfix"}],
            "assignees": [],
        }
        result = handle_edit_issue({
            "owner": "o",
            "repo": "r",
            "issue_number": 2,
            "title": "Updated",
            "state": "closed",
            "labels": ["wontfix"],
        })
        self.assertEqual(result["state"], "closed")
        self.assertIn("wontfix", result["labels"])

    def test_edit_issue_no_updates(self):
        result = handle_edit_issue({"owner": "o", "repo": "r", "issue_number": 1})
        self.assertIn("error", result)

    def test_edit_issue_missing_params(self):
        result = handle_edit_issue({"owner": "o", "title": "New"})
        self.assertIn("error", result)


class TestHandleCloseIssue(unittest.TestCase):
    """Test closing and reopening issues."""

    @patch("github_client._api_request")
    def test_close_issue(self, mock_api):
        mock_api.return_value = {
            "number": 5,
            "title": "Closed issue",
            "html_url": "https://github.com/o/r/issues/5",
            "state": "closed",
            "created_at": "2026-03-13T00:00:00Z",
            "labels": [],
            "assignees": [],
        }
        result = handle_close_issue({"owner": "o", "repo": "r", "issue_number": 5})
        self.assertEqual(result["state"], "closed")
        call_args = mock_api.call_args
        self.assertEqual(call_args[0][2]["state"], "closed")

    @patch("github_client._api_request")
    def test_reopen_issue(self, mock_api):
        mock_api.return_value = {
            "number": 6,
            "title": "Reopened issue",
            "html_url": "https://github.com/o/r/issues/6",
            "state": "open",
            "created_at": "2026-03-13T00:00:00Z",
            "labels": [],
            "assignees": [],
        }
        result = handle_close_issue({
            "owner": "o",
            "repo": "r",
            "issue_number": 6,
            "reopen": True,
        })
        self.assertEqual(result["state"], "open")
        call_args = mock_api.call_args
        self.assertEqual(call_args[0][2]["state"], "open")


class TestHandleCommentIssue(unittest.TestCase):
    """Test adding comments to issues."""

    @patch("github_client._api_request")
    def test_comment_issue_success(self, mock_api):
        mock_api.return_value = {
            "id": 12345,
            "body": "This is a comment",
            "user": {"login": "bot"},
            "created_at": "2026-03-13T00:00:00Z",
            "html_url": "https://github.com/o/r/issues/1#issuecomment-12345",
        }
        result = handle_comment_issue({
            "owner": "o",
            "repo": "r",
            "issue_number": 1,
            "body": "This is a comment",
        })
        self.assertEqual(result["id"], 12345)
        self.assertEqual(result["body"], "This is a comment")
        self.assertEqual(result["user"], "bot")
        mock_api.assert_called_once()

    def test_comment_issue_missing_body(self):
        result = handle_comment_issue({
            "owner": "o",
            "repo": "r",
            "issue_number": 1,
            "body": "",
        })
        self.assertIn("error", result)

    def test_comment_issue_missing_params(self):
        result = handle_comment_issue({"owner": "o", "body": "Test"})
        self.assertIn("error", result)


class TestHandleListIssues(unittest.TestCase):
    """Test listing issues."""

    @patch("github_client._api_request")
    def test_list_issues_default(self, mock_api):
        mock_api.return_value = [
            {
                "number": 1,
                "title": "Issue 1",
                "html_url": "https://github.com/o/r/issues/1",
                "state": "open",
                "created_at": "2026-03-13T00:00:00Z",
                "labels": [],
                "assignees": [],
            },
            {
                "number": 2,
                "title": "Issue 2",
                "html_url": "https://github.com/o/r/issues/2",
                "state": "open",
                "created_at": "2026-03-13T00:00:00Z",
                "labels": [{"name": "bug"}],
                "assignees": [],
            },
        ]
        result = handle_list_issues({"owner": "o", "repo": "r"})
        self.assertEqual(result["count"], 2)
        self.assertEqual(len(result["issues"]), 2)
        self.assertEqual(result["issues"][0]["number"], 1)

    @patch("github_client._api_request")
    def test_list_issues_with_filters(self, mock_api):
        from urllib.parse import parse_qs, urlparse

        mock_api.return_value = []
        result = handle_list_issues({
            "owner": "o",
            "repo": "r",
            "state": "closed",
            "labels": "bug,enhancement",
            "assignee": "alice",
        })
        self.assertEqual(result["count"], 0)
        call_url = mock_api.call_args[0][1]
        query = parse_qs(urlparse(call_url).query)
        self.assertEqual(query["state"], ["closed"])
        self.assertEqual(query["labels"], ["bug,enhancement"])
        self.assertEqual(query["assignee"], ["alice"])


class TestCallDispatch(unittest.TestCase):
    """Test dispatch for issue tools."""

    @patch("tools.get_issue")
    def test_call_get_issue(self, mock_get):
        mock_get.return_value = {"number": 1, "title": "Test"}
        result = call("github_get_issue", {"owner": "o", "repo": "r", "issue_number": 1})
        self.assertNotIn("error", result)

    @patch("tools.edit_issue")
    def test_call_edit_issue(self, mock_edit):
        mock_edit.return_value = {"number": 1, "title": "Updated"}
        result = call("github_edit_issue", {
            "owner": "o",
            "repo": "r",
            "issue_number": 1,
            "title": "Updated",
        })
        self.assertNotIn("error", result)


if __name__ == "__main__":
    unittest.main(verbosity=2)
