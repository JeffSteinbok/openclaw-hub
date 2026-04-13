#!/usr/bin/env python3
"""
Unit tests for stock-quotes plugin.

Run: python3 -m pytest tests/test_tools.py -v
Or: python3 tests/test_tools.py
"""

import unittest
from unittest.mock import patch, MagicMock
import sys
import os
import json

# Add src directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from tools import manifest, call, handle_stock_quote, handle_stock_quotes
from stock_client import get_stock_quote, get_stock_quotes


class TestManifest(unittest.TestCase):
    """Test the manifest function returns proper tool definitions."""

    def test_manifest_has_tools(self):
        """Manifest should return a dict with 'tools' list."""
        m = manifest()
        self.assertIn("tools", m)
        self.assertIsInstance(m["tools"], list)

    def test_manifest_has_stock_quote_tool(self):
        """Manifest should include stock_quote tool."""
        m = manifest()
        tool_names = [t["name"] for t in m["tools"]]
        self.assertIn("stock_quote", tool_names)

    def test_manifest_has_stock_quotes_tool(self):
        """Manifest should include stock_quotes tool."""
        m = manifest()
        tool_names = [t["name"] for t in m["tools"]]
        self.assertIn("stock_quotes", tool_names)

    def test_manifest_tools_have_required_fields(self):
        """Each tool should have name, description, and input_schema."""
        m = manifest()
        for tool in m["tools"]:
            self.assertIn("name", tool)
            self.assertIn("description", tool)
            self.assertIn("input_schema", tool)
            self.assertIsInstance(tool["name"], str)
            self.assertIsInstance(tool["description"], str)
            self.assertIsInstance(tool["input_schema"], dict)


class TestHandleStockQuote(unittest.TestCase):
    """Test the handle_stock_quote handler."""

    def test_missing_symbol_returns_error(self):
        """Handler should return error when symbol is missing."""
        result = handle_stock_quote({})
        self.assertIn("error", result)
        self.assertIn("symbol", result["error"].lower())

    def test_empty_symbol_returns_error(self):
        """Handler should return error when symbol is empty."""
        result = handle_stock_quote({"symbol": ""})
        self.assertIn("error", result)

    def test_whitespace_symbol_returns_error(self):
        """Handler should return error when symbol is only whitespace."""
        result = handle_stock_quote({"symbol": "   "})
        self.assertIn("error", result)

    @patch("stock_client._fetch_yahoo_quote")
    def test_valid_symbol_calls_client(self, mock_fetch):
        """Handler should call stock client with valid symbol."""
        mock_fetch.return_value = {
            "symbol": "AAPL",
            "price": 150.25,
            "previous_close": 149.00,
            "change": 1.25,
            "change_percent": 0.84,
            "currency": "USD",
            "market_state": "REGULAR",
            "timestamp": "2026-03-14T16:00:00",
            "source": "yahoo_finance",
        }
        result = handle_stock_quote({"symbol": "AAPL"})
        self.assertNotIn("error", result)
        self.assertEqual(result["symbol"], "AAPL")
        self.assertEqual(result["price"], 150.25)
        mock_fetch.assert_called_once()

    @patch("stock_client._fetch_yahoo_quote")
    def test_lowercase_symbol_normalized(self, mock_fetch):
        """Handler should normalize lowercase symbols to uppercase."""
        mock_fetch.return_value = {
            "symbol": "MSFT",
            "price": 300.00,
            "previous_close": 299.50,
            "change": 0.50,
            "change_percent": 0.17,
            "currency": "USD",
            "market_state": "REGULAR",
            "timestamp": "2026-03-14T16:00:00",
            "source": "yahoo_finance",
        }
        result = handle_stock_quote({"symbol": "msft"})
        self.assertNotIn("error", result)
        self.assertEqual(result["symbol"], "MSFT")


class TestHandleStockQuotes(unittest.TestCase):
    """Test the handle_stock_quotes handler."""

    def test_missing_symbols_returns_error(self):
        """Handler should return error when symbols is missing."""
        result = handle_stock_quotes({})
        self.assertIn("error", result)

    def test_empty_symbols_array_returns_error(self):
        """Handler should return error when symbols array is empty."""
        result = handle_stock_quotes({"symbols": []})
        self.assertIn("error", result)

    def test_non_array_symbols_returns_error(self):
        """Handler should return error when symbols is not an array."""
        result = handle_stock_quotes({"symbols": "AAPL"})
        self.assertIn("error", result)

    def test_non_string_symbols_returns_error(self):
        """Handler should return error when symbols contain non-strings."""
        result = handle_stock_quotes({"symbols": ["AAPL", 123, "MSFT"]})
        self.assertIn("error", result)

    @patch("stock_client.get_stock_quote")
    def test_valid_symbols_calls_client(self, mock_get_quote):
        """Handler should call client for each symbol."""
        mock_get_quote.side_effect = [
            {
                "symbol": "AAPL",
                "price": 150.25,
                "previous_close": 149.00,
                "change": 1.25,
                "change_percent": 0.84,
                "currency": "USD",
                "market_state": "REGULAR",
                "timestamp": "2026-03-14T16:00:00",
                "source": "yahoo_finance",
            },
            {
                "symbol": "MSFT",
                "price": 300.00,
                "previous_close": 299.50,
                "change": 0.50,
                "change_percent": 0.17,
                "currency": "USD",
                "market_state": "REGULAR",
                "timestamp": "2026-03-14T16:00:00",
                "source": "yahoo_finance",
            },
        ]
        result = handle_stock_quotes({"symbols": ["AAPL", "MSFT"]})
        self.assertNotIn("error", result)
        self.assertIn("quotes", result)
        self.assertEqual(len(result["quotes"]), 2)
        self.assertEqual(result["count"], 2)

    @patch("stock_client.get_stock_quote")
    def test_handles_mixed_success_failure(self, mock_get_quote):
        """Handler should return both successful quotes and errors."""
        mock_get_quote.side_effect = [
            {
                "symbol": "AAPL",
                "price": 150.25,
                "previous_close": 149.00,
                "change": 1.25,
                "change_percent": 0.84,
                "currency": "USD",
                "market_state": "REGULAR",
                "timestamp": "2026-03-14T16:00:00",
                "source": "yahoo_finance",
            },
            {"error": "Symbol INVALID not found"},
        ]
        result = handle_stock_quotes({"symbols": ["AAPL", "INVALID"]})
        self.assertNotIn("error", result)
        self.assertIn("quotes", result)
        self.assertIn("errors", result)
        self.assertEqual(len(result["quotes"]), 1)
        self.assertEqual(len(result["errors"]), 1)
        self.assertEqual(result["quotes"][0]["symbol"], "AAPL")
        self.assertEqual(result["errors"][0]["symbol"], "INVALID")


class TestCall(unittest.TestCase):
    """Test the call dispatcher."""

    def test_unknown_tool_returns_error(self):
        """Call should return error for unknown tool names."""
        result = call("unknown_tool", {})
        self.assertIn("error", result)
        self.assertIn("Unknown tool", result["error"])

    @patch("stock_client._fetch_yahoo_quote")
    def test_calls_stock_quote_handler(self, mock_fetch):
        """Call should dispatch to stock_quote handler."""
        mock_fetch.return_value = {
            "symbol": "AAPL",
            "price": 150.25,
            "previous_close": 149.00,
            "change": 1.25,
            "change_percent": 0.84,
            "currency": "USD",
            "market_state": "REGULAR",
            "timestamp": "2026-03-14T16:00:00",
            "source": "yahoo_finance",
        }
        result = call("stock_quote", {"symbol": "AAPL"})
        self.assertNotIn("error", result)
        self.assertEqual(result["symbol"], "AAPL")

    @patch("stock_client.get_stock_quote")
    def test_calls_stock_quotes_handler(self, mock_get_quote):
        """Call should dispatch to stock_quotes handler."""
        mock_get_quote.return_value = {
            "symbol": "AAPL",
            "price": 150.25,
            "previous_close": 149.00,
            "change": 1.25,
            "change_percent": 0.84,
            "currency": "USD",
            "market_state": "REGULAR",
            "timestamp": "2026-03-14T16:00:00",
            "source": "yahoo_finance",
        }
        result = call("stock_quotes", {"symbols": ["AAPL"]})
        self.assertNotIn("error", result)
        self.assertIn("quotes", result)


if __name__ == "__main__":
    unittest.main(verbosity=2)
