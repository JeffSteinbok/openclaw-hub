"""Unit tests for the GitHub plugin (no network access required)."""

import json
import sys
import os
import unittest
from unittest.mock import MagicMock, patch

# Add src dir to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import tools as plugin_tools
from tools import manifest, call, handle_create_issue


class TestManifest(unittest.TestCase):
    """Verify the plugin manifest is well-formed."""

    def test_manifest_has_tools(self):
        m = manifest()
        self.assertIn("tools", m)
        self.assertIsInstance(m["tools"], list)
        self.assertGreater(len(m["tools"]), 0)

    def test_manifest_create_issue_tool(self):
        m = manifest()
        names = [t["name"] for t in m["tools"]]
        self.assertIn("github_create_issue", names)

    def test_create_issue_schema(self):
        m = manifest()
        tool = next(t for t in m["tools"] if t["name"] == "github_create_issue")
        schema = tool["input_schema"]
        self.assertEqual(schema["type"], "object")
        self.assertIn("owner", schema["properties"])
        self.assertIn("repo", schema["properties"])
        self.assertIn("title", schema["properties"])
        self.assertIn("body", schema["properties"])
        self.assertIn("labels", schema["properties"])
        self.assertIn("assignees", schema["properties"])
        self.assertIn("milestone", schema["properties"])
        self.assertEqual(schema["required"], ["owner", "repo", "title"])
        self.assertFalse(schema.get("additionalProperties", True))

    def test_create_issue_description(self):
        m = manifest()
        tool = next(t for t in m["tools"] if t["name"] == "github_create_issue")
        self.assertIn("GitHub", tool["description"])
        self.assertIn("issue", tool["description"].lower())


class TestHandleCreateIssueValidation(unittest.TestCase):
    """Test input validation in handle_create_issue."""

    def test_missing_owner_returns_error(self):
        result = handle_create_issue({"repo": "myrepo", "title": "Bug"})
        self.assertIn("error", result)

    def test_missing_repo_returns_error(self):
        result = handle_create_issue({"owner": "myuser", "title": "Bug"})
        self.assertIn("error", result)

    def test_missing_title_returns_error(self):
        result = handle_create_issue({"owner": "myuser", "repo": "myrepo"})
        self.assertIn("error", result)

    def test_all_required_missing_returns_error(self):
        result = handle_create_issue({})
        self.assertIn("error", result)

    def test_empty_owner_returns_error(self):
        result = handle_create_issue({"owner": "  ", "repo": "myrepo", "title": "Bug"})
        self.assertIn("error", result)

    def test_empty_title_returns_error(self):
        result = handle_create_issue({"owner": "myuser", "repo": "myrepo", "title": "  "})
        self.assertIn("error", result)


class TestHandleCreateIssue(unittest.TestCase):
    """Test successful issue creation with mocked GitHub API."""

    def _make_api_response(self):
        return {
            "number": 99,
            "title": "Test Issue",
            "html_url": "https://github.com/owner/repo/issues/99",
            "state": "open",
            "created_at": "2026-03-09T16:00:00Z",
            "labels": [{"name": "bug"}],
            "assignees": [{"login": "octocat"}],
        }

    @patch("github_client._api_request")
    def test_create_issue_returns_expected_fields(self, mock_api):
        mock_api.return_value = self._make_api_response()
        result = handle_create_issue({
            "owner": "owner",
            "repo": "repo",
            "title": "Test Issue",
            "body": "Description here",
            "labels": ["bug"],
            "assignees": ["octocat"],
        })
        self.assertEqual(result["number"], 99)
        self.assertEqual(result["title"], "Test Issue")
        self.assertEqual(result["url"], "https://github.com/owner/repo/issues/99")
        self.assertEqual(result["state"], "open")
        self.assertIn("bug", result["labels"])
        self.assertIn("octocat", result["assignees"])

    @patch("github_client._api_request")
    def test_create_issue_minimal_args(self, mock_api):
        mock_api.return_value = {
            "number": 1,
            "title": "Minimal",
            "html_url": "https://github.com/a/b/issues/1",
            "state": "open",
            "created_at": "2026-03-09T00:00:00Z",
            "labels": [],
            "assignees": [],
        }
        result = handle_create_issue({"owner": "a", "repo": "b", "title": "Minimal"})
        self.assertNotIn("error", result)
        self.assertEqual(result["number"], 1)

    @patch("github_client._api_request")
    def test_api_error_is_propagated(self, mock_api):
        mock_api.return_value = {"error": "HTTP 404: Not Found"}
        result = handle_create_issue({"owner": "a", "repo": "b", "title": "Bad"})
        self.assertIn("error", result)

    @patch("github_client._api_request")
    def test_create_issue_sends_correct_payload(self, mock_api):
        mock_api.return_value = {
            "number": 5, "title": "T", "html_url": "https://github.com/o/r/issues/5",
            "state": "open", "created_at": "2026-03-09T00:00:00Z",
            "labels": [{"name": "enhancement"}], "assignees": [],
        }
        handle_create_issue({
            "owner": "o",
            "repo": "r",
            "title": "T",
            "body": "Body text",
            "labels": ["enhancement"],
            "milestone": 3,
        })
        call_args = mock_api.call_args
        self.assertEqual(call_args[0][0], "POST")
        self.assertEqual(call_args[0][1], "/repos/o/r/issues")
        payload = call_args[0][2]
        self.assertEqual(payload["title"], "T")
        self.assertEqual(payload["body"], "Body text")
        self.assertEqual(payload["labels"], ["enhancement"])
        self.assertEqual(payload["milestone"], 3)

    @patch("github_client._api_request")
    def test_empty_labels_not_sent(self, mock_api):
        mock_api.return_value = {
            "number": 2, "title": "T", "html_url": "https://github.com/o/r/issues/2",
            "state": "open", "created_at": "2026-03-09T00:00:00Z",
            "labels": [], "assignees": [],
        }
        handle_create_issue({"owner": "o", "repo": "r", "title": "T", "labels": []})
        payload = mock_api.call_args[0][2]
        self.assertNotIn("labels", payload)


class TestCallDispatch(unittest.TestCase):
    """Test the call() dispatch function."""

    @patch("tools.create_issue")
    def test_call_dispatches_to_create_issue(self, mock_create):
        mock_create.return_value = {
            "number": 1, "title": "T", "url": "https://github.com/o/r/issues/1",
            "state": "open", "created_at": "2026-03-09T00:00:00Z",
            "labels": [], "assignees": [],
        }
        result = call("github_create_issue", {"owner": "o", "repo": "r", "title": "T"})
        self.assertNotIn("error", result)

    def test_call_unknown_tool_returns_error(self):
        result = call("nonexistent_tool", {})
        self.assertIn("error", result)


class TestMainDispatch(unittest.TestCase):
    """Test the main() stdin/stdout dispatch."""

    @patch("sys.stdin")
    @patch("sys.stdout")
    def test_main_manifest(self, mock_stdout, mock_stdin):
        mock_stdin.read.return_value = json.dumps({"method": "manifest"})
        # Redirect stdout
        import io
        buf = io.StringIO()
        with patch("sys.stdin", new=io.StringIO(json.dumps({"method": "manifest"}))):
            with patch("builtins.print") as mock_print:
                plugin_tools.main()
                output = mock_print.call_args[0][0]
                parsed = json.loads(output)
                self.assertIn("tools", parsed)


if __name__ == "__main__":
    unittest.main(verbosity=2)
