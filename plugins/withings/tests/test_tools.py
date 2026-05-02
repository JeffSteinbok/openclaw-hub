#!/usr/bin/env python3

import json
import os
import sys
import unittest
from unittest.mock import patch


_SRC_DIR = os.path.join(os.path.dirname(__file__), "..", "src")
sys.path.insert(0, _SRC_DIR)

os.environ.setdefault("WITHINGS_CLIENT_ID", "test-client-id")
os.environ.setdefault("WITHINGS_CLIENT_SECRET", "test-client-secret")

import tools  # noqa: E402


class TestManifest(unittest.TestCase):
    def test_manifest_has_expected_tools(self):
        tool_names = {tool["name"] for tool in tools.MANIFEST["tools"]}
        self.assertEqual(
            tool_names,
            {
                "withings_auth_url",
                "withings_auth_complete",
                "withings_auth_status",
                "withings_get_measurements",
                "withings_get_activity",
                "withings_get_sleep",
                "withings_get_heart",
            },
        )


class TestAuthHelpers(unittest.TestCase):
    def test_auth_url_requires_config(self):
        with patch.object(tools, "CLIENT_ID", ""), patch.object(tools, "CLIENT_SECRET", ""):
            result = tools.withings_auth_url({})
        self.assertIn("error", result)

    def test_auth_url_contains_expected_parts(self):
        with patch.object(tools, "CLIENT_ID", "abc123"), patch.object(tools, "CLIENT_SECRET", "secret"), patch.object(
            tools, "REDIRECT_URI", "http://localhost:18789/plugins/withings/oauth/callback"
        ):
            result = tools.withings_auth_url({})
        self.assertIn("url", result)
        self.assertIn("response_type=code", result["url"])
        self.assertIn("client_id=abc123", result["url"])

    def test_auth_status_without_tokens(self):
        with patch.object(tools, "_load_tokens", return_value={}):
            result = tools.withings_auth_status({})
        self.assertFalse(result["linked"])


class TestDispatch(unittest.TestCase):
    def test_unknown_tool_errors(self):
        payload = {"method": "call", "tool": "missing", "args": {}}
        with patch("sys.stdin.read", return_value=json.dumps(payload)), patch("builtins.print") as mock_print:
            tools.main()
        printed = mock_print.call_args[0][0]
        self.assertIn("Unknown tool", printed)


if __name__ == "__main__":
    unittest.main()
