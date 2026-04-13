"""Unit tests for the USPS mail plugin."""

import os
import sys
import unittest

_SRC_DIR = os.path.join(os.path.dirname(__file__), "..", "src")
sys.path.insert(0, _SRC_DIR)

import tools  # noqa: E402


class TestUspsManifest(unittest.TestCase):
    """Smoke tests for USPS plugin dispatch and shared-lib imports."""

    def test_manifest_has_expected_tools(self):
        manifest = tools.manifest()
        self.assertIn("tools", manifest)
        tool_names = {tool["name"] for tool in manifest["tools"]}
        self.assertEqual(
            tool_names,
            {
                "usps_process_digest",
                "usps_lookup",
                "usps_update_rule",
                "usps_rules",
                "usps_stats",
                "usps_status",
            },
        )

    def test_shared_runtime_imports_come_from_mail_runtime_core(self):
        self.assertEqual(tools.process_digest.__module__, "mail_action_usps.analyze")
        self.assertEqual(tools.lookup.__module__, "mail_action_usps.memory")


if __name__ == "__main__":
    unittest.main(verbosity=2)
