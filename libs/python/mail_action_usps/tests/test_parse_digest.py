#!/usr/bin/env python3
"""Tests for mail_action_usps.parse_digest module."""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from mail_action_usps.parse_digest import parse_all_digests, parse_digest_html

SAMPLE_HTML = """\
<html>
<body>
<p>You have 3 mailpieces arriving today.</p>
<p>You have 1 package arriving soon.</p>
<div>
  <p>FROM: ACME Corporation</p>
  <img src="cid:image001.jpg" />
</div>
<div>
  <p>From: Bank of America</p>
  <img src="cid:image002.jpg" />
</div>
<div>
  <p>FROM: US Treasury</p>
</div>
<p>Tracking: 9400111899223100001234</p>
</body>
</html>
"""

NO_IMAGE_HTML = """\
<html>
<body>
<p>You have 1 mailpiece arriving today.</p>
<p>A scanned image of this mail piece is not available at this time.</p>
</body>
</html>
"""

MINIMAL_HTML = "<html><body><p>Hello</p></body></html>"


class TestParseDigestHtml(unittest.TestCase):
    def _write_html(self, content):
        f = tempfile.NamedTemporaryFile(mode="w", suffix=".html", delete=False)
        f.write(content)
        f.flush()
        f.close()
        return f.name

    def test_mail_count(self):
        path = self._write_html(SAMPLE_HTML)
        try:
            result = parse_digest_html(path)
            self.assertEqual(result["mail_count"], 3)
        finally:
            os.unlink(path)

    def test_package_count(self):
        path = self._write_html(SAMPLE_HTML)
        try:
            result = parse_digest_html(path)
            self.assertEqual(result["package_count"], 1)
        finally:
            os.unlink(path)

    def test_from_labels(self):
        path = self._write_html(SAMPLE_HTML)
        try:
            result = parse_digest_html(path)
            self.assertIn("ACME Corporation", result["from_labels"])
            self.assertIn("Bank of America", result["from_labels"])
            self.assertIn("US Treasury", result["from_labels"])
        finally:
            os.unlink(path)

    def test_image_cids(self):
        path = self._write_html(SAMPLE_HTML)
        try:
            result = parse_digest_html(path)
            self.assertIn("image001.jpg", result["image_cids"])
            self.assertIn("image002.jpg", result["image_cids"])
            self.assertEqual(len(result["image_cids"]), 2)
        finally:
            os.unlink(path)

    def test_tracking_numbers(self):
        path = self._write_html(SAMPLE_HTML)
        try:
            result = parse_digest_html(path)
            self.assertIn("9400111899223100001234", result["tracking_numbers"])
        finally:
            os.unlink(path)

    def test_no_image_flag(self):
        path = self._write_html(NO_IMAGE_HTML)
        try:
            result = parse_digest_html(path)
            self.assertTrue(result["has_no_image"])
        finally:
            os.unlink(path)

    def test_no_image_flag_false(self):
        path = self._write_html(SAMPLE_HTML)
        try:
            result = parse_digest_html(path)
            self.assertFalse(result["has_no_image"])
        finally:
            os.unlink(path)

    def test_minimal_html(self):
        path = self._write_html(MINIMAL_HTML)
        try:
            result = parse_digest_html(path)
            self.assertEqual(result["mail_count"], 0)
            self.assertEqual(result["package_count"], 0)
            self.assertEqual(result["from_labels"], [])
            self.assertEqual(result["image_cids"], [])
            self.assertEqual(result["tracking_numbers"], [])
            self.assertFalse(result["has_no_image"])
        finally:
            os.unlink(path)


class TestParseAllDigests(unittest.TestCase):
    def test_multiple_date_dirs(self):
        with tempfile.TemporaryDirectory() as td:
            for date in ("2024-01-15", "2024-01-16"):
                d = os.path.join(td, date)
                os.makedirs(d)
                with open(os.path.join(d, "body.html"), "w") as f:
                    f.write(f"<html><body><p>You have 2 mailpieces.</p></body></html>")

            result = parse_all_digests(td)
            self.assertIn("2024-01-15", result)
            self.assertIn("2024-01-16", result)
            self.assertEqual(result["2024-01-15"]["mail_count"], 2)

    def test_skips_non_date_dirs(self):
        with tempfile.TemporaryDirectory() as td:
            os.makedirs(os.path.join(td, "not-a-date"))
            with open(os.path.join(td, "not-a-date", "body.html"), "w") as f:
                f.write("<html><body></body></html>")

            os.makedirs(os.path.join(td, "2024-01-15"))
            with open(os.path.join(td, "2024-01-15", "body.html"), "w") as f:
                f.write("<html><body><p>You have 1 mailpiece.</p></body></html>")

            result = parse_all_digests(td)
            self.assertNotIn("not-a-date", result)
            self.assertIn("2024-01-15", result)

    def test_skips_dirs_without_body_html(self):
        with tempfile.TemporaryDirectory() as td:
            os.makedirs(os.path.join(td, "2024-01-15"))
            # No body.html here

            result = parse_all_digests(td)
            self.assertEqual(len(result), 0)

    def test_images_listed(self):
        with tempfile.TemporaryDirectory() as td:
            d = os.path.join(td, "2024-01-15")
            os.makedirs(d)
            with open(os.path.join(d, "body.html"), "w") as f:
                f.write("<html><body></body></html>")
            # Create image files
            open(os.path.join(d, "1234567890-001.jpg"), "w").close()
            open(os.path.join(d, "mailer-ad1.jpg"), "w").close()
            open(os.path.join(d, "content-header.jpg"), "w").close()

            result = parse_all_digests(td)
            info = result["2024-01-15"]
            self.assertIn("1234567890-001.jpg", info["scan_images"])
            self.assertIn("mailer-ad1.jpg", info["ad_images"])
            # content- images are excluded from main images list
            self.assertNotIn("content-header.jpg", info["images"])

    def test_empty_dir(self):
        with tempfile.TemporaryDirectory() as td:
            result = parse_all_digests(td)
            self.assertEqual(result, {})


if __name__ == "__main__":
    unittest.main()
