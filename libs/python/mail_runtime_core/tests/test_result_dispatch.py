#!/usr/bin/env python3
"""Tests for result_dispatch.py"""

import sys
import os
import unittest
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from mail_runtime_core.runtime import ActionResult
from mail_runtime_core.result_dispatch import dispatch_results


class TestDispatchResults(unittest.TestCase):
    def test_log_kind(self):
        logger = MagicMock()
        results = [ActionResult(kind="log", payload={"message": "hello"})]
        dispatch_results(results, logger=logger)
        logger.assert_called_once_with("hello")

    def test_known_handler(self):
        logger = MagicMock()
        handler = MagicMock()
        results = [ActionResult(kind="message", payload={"text": "hi"})]
        dispatch_results(results, logger=logger, handlers={"message": handler})
        handler.assert_called_once_with({"text": "hi"})
        logger.assert_not_called()

    def test_unknown_kind_warning(self):
        logger = MagicMock()
        results = [ActionResult(kind="alien", payload={"x": 1})]
        dispatch_results(results, logger=logger)
        logger.assert_called_once()
        self.assertIn("unknown", logger.call_args[0][0].lower())

    def test_multiple_results(self):
        logger = MagicMock()
        handler = MagicMock()
        results = [
            ActionResult(kind="log", payload={"message": "a"}),
            ActionResult(kind="notify", payload={"msg": "b"}),
            ActionResult(kind="unknown_thing", payload={}),
        ]
        dispatch_results(results, logger=logger, handlers={"notify": handler})
        self.assertEqual(logger.call_count, 2)  # log + unknown warning
        handler.assert_called_once_with({"msg": "b"})

    def test_empty_results(self):
        logger = MagicMock()
        dispatch_results([], logger=logger)
        logger.assert_not_called()

    def test_no_handlers_dict(self):
        logger = MagicMock()
        results = [ActionResult(kind="custom", payload={"k": "v"})]
        dispatch_results(results, logger=logger)
        self.assertIn("unknown", logger.call_args[0][0].lower())


if __name__ == "__main__":
    unittest.main()
