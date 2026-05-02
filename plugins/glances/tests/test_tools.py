#!/usr/bin/env python3

import os
import sys
import unittest
from unittest.mock import patch


_SRC_DIR = os.path.join(os.path.dirname(__file__), "..", "src")
sys.path.insert(0, _SRC_DIR)

os.environ.setdefault("GLANCES_BASE_URL", "http://127.0.0.1:61208")

import tools  # noqa: E402


class TestManifest(unittest.TestCase):
    def test_manifest_has_expected_tools(self):
        manifest = tools.manifest()
        names = {tool["name"] for tool in manifest["tools"]}
        self.assertEqual(
            names,
            {
                "glances_summary_get",
                "glances_cpu_get",
                "glances_memory_get",
                "glances_disk_get",
                "glances_endpoint_get",
            },
        )


class TestHelpers(unittest.TestCase):
    def test_normalize_base_url_strips_trailing_slash(self):
        self.assertEqual(tools._normalize_base_url("http://x:1/"), "http://x:1")

    def test_select_fs_entry_prefers_requested_mount(self):
        entries = [{"mnt_point": "/boot"}, {"mnt_point": "/"}]
        self.assertEqual(tools._select_fs_entry(entries, "/")["mnt_point"], "/")

    def test_shape_disk_adds_gib_fields(self):
        shaped = tools._shape_disk({"mnt_point": "/", "used": 1073741824, "free": 2147483648, "size": 3221225472})
        self.assertEqual(shaped["used_gib"], 1.0)
        self.assertEqual(shaped["free_gib"], 2.0)
        self.assertEqual(shaped["size_gib"], 3.0)


class TestHandlers(unittest.TestCase):
    @patch("tools._api_get_json")
    def test_summary_compacts_outputs(self, mock_api_get_json):
        mock_api_get_json.side_effect = [
            {
                "output": {
                    "cpu": 12.3,
                    "mem": 45.6,
                    "swap": 0.0,
                    "cpu_name": "Test CPU",
                }
            },
            {
                "output": [
                    {
                        "mnt_point": "/",
                        "device_name": "/dev/test",
                        "fs_type": "ext4",
                        "percent": 50.0,
                        "used": 2147483648,
                        "free": 2147483648,
                        "size": 4294967296,
                    }
                ]
            },
            {"output": "01:23:45"},
        ]

        result = tools.handle_glances_summary_get({})
        self.assertEqual(result["output"]["cpu_percent"], 12.3)
        self.assertEqual(result["output"]["memory_percent"], 45.6)
        self.assertEqual(result["output"]["disk"]["mount_point"], "/")
        self.assertEqual(result["output"]["uptime"], "01:23:45")

    @patch("tools._api_get_json")
    def test_cpu_get_can_include_percpu(self, mock_api_get_json):
        mock_api_get_json.side_effect = [
            {"output": {"total": 22.5}},
            {"output": {"percpu": [{"cpu_number": 0, "total": 12.0}]}},
        ]

        result = tools.handle_glances_cpu_get({"include_percpu": True})
        self.assertEqual(result["output"]["total"], 22.5)
        self.assertEqual(result["output"]["percpu"][0]["cpu_number"], 0)

    @patch("tools._api_get_json")
    def test_memory_get_adds_gib_fields(self, mock_api_get_json):
        mock_api_get_json.return_value = {
            "output": {
                "percent": 25.0,
                "used": 2147483648,
                "available": 6442450944,
                "free": 4294967296,
                "total": 8589934592,
            }
        }

        result = tools.handle_glances_memory_get({})
        self.assertEqual(result["output"]["used_gib"], 2.0)
        self.assertEqual(result["output"]["total_gib"], 8.0)

    @patch("tools._api_get_json")
    def test_disk_get_errors_when_mount_missing(self, mock_api_get_json):
        mock_api_get_json.return_value = {"output": [{"mnt_point": "/"}]}
        result = tools.handle_glances_disk_get({"mount_point": "/data"})
        self.assertIn("error", result)

    def test_endpoint_path_is_restricted(self):
        result = tools.handle_glances_endpoint_get({"path": "/api/4/cpu"})
        self.assertIn("error", result)


if __name__ == "__main__":
    unittest.main()
