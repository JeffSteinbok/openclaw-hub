"""Stock quotes plugin tools — fetch stock prices via Yahoo Finance or Finnhub."""

import json
import os
import sys

# Ensure sibling modules are importable when run directly
sys.path.insert(0, os.path.dirname(__file__))

from stock_client import get_stock_quote, get_stock_quotes


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


def handle_stock_quote(args: dict) -> dict:
    """Get a single stock quote."""
    symbol = args.get("symbol", "").strip()

    if not symbol:
        return {"error": "symbol is required"}

    return get_stock_quote(symbol)


def handle_stock_quotes(args: dict) -> dict:
    """Get multiple stock quotes in batch."""
    symbols = args.get("symbols", [])

    if not symbols:
        return {"error": "symbols array is required and must not be empty"}

    if not isinstance(symbols, list):
        return {"error": "symbols must be an array of strings"}

    # Validate each symbol
    for symbol in symbols:
        if not isinstance(symbol, str):
            return {"error": "All symbols must be strings"}

    return get_stock_quotes(symbols)


# ---------------------------------------------------------------------------
# Standard plugin dispatch
# ---------------------------------------------------------------------------

TOOLS = {
    "stock_quote": {
        "description": "Get the latest quote for a stock, ETF, or mutual fund symbol.",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {
                    "type": "string",
                    "description": "Stock ticker symbol (e.g., AAPL, GOOGL, QQQ, FXAIX)",
                },
            },
            "required": ["symbol"],
            "additionalProperties": False,
        },
        "handler": handle_stock_quote,
    },
    "stock_quotes": {
        "description": "Get the latest quotes for multiple stock, ETF, or mutual fund symbols.",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbols": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Array of stock ticker symbols (e.g., ['MSFT', 'QQQ', 'FXAIX'])",
                    "minItems": 1,
                },
            },
            "required": ["symbols"],
            "additionalProperties": False,
        },
        "handler": handle_stock_quotes,
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
