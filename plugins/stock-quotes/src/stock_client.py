#!/usr/bin/env python3
"""
Stock quotes client for OpenClaw.

Fetches stock, ETF, and mutual fund prices from Yahoo Finance API (no auth required).
Optionally supports Finnhub API with FINNHUB_API_KEY env var.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

YAHOO_FINANCE_API_BASE = "https://query1.finance.yahoo.com/v8/finance/chart"
FINNHUB_API_BASE = "https://finnhub.io/api/v1"


def _get_finnhub_api_key() -> str | None:
    """Get Finnhub API key from environment if set."""
    return os.environ.get("FINNHUB_API_KEY", "").strip() or None


def _fetch_yahoo_quote(symbol: str) -> dict:
    """
    Fetch a stock quote from Yahoo Finance unofficial API.

    Returns dict with price data or error message.
    Works for stocks, ETFs, and mutual funds (FXAIX, FOCPX, etc.)
    """
    url = f"{YAHOO_FINANCE_API_BASE}/{symbol}?interval=1d&range=1d"
    req = urllib.request.Request(url)
    req.add_header("User-Agent", "Mozilla/5.0")

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())

            # Check for API errors (Yahoo always includes "error": null, so check value not key)
            chart_error = data.get("chart", {}).get("error")
            if "chart" not in data or chart_error:
                error_msg = (chart_error or {}).get("description", "Unknown error") if isinstance(chart_error, dict) else str(chart_error)
                return {"error": f"Yahoo Finance API error: {error_msg}"}

            chart_data = data.get("chart", {}).get("result")
            if not chart_data:
                return {"error": f"No data found for symbol {symbol}"}

            meta = chart_data[0].get("meta") or {}
            if not meta:
                return {"error": f"No metadata found for symbol {symbol}"}

            # Extract price data
            current_price = meta.get("regularMarketPrice")
            previous_close = meta.get("chartPreviousClose")
            currency = meta.get("currency", "USD")
            market_state = meta.get("marketState", "REGULAR")
            tz_name = meta.get("exchangeTimezoneName", "America/New_York")

            # Calculate change and percent change
            if current_price is not None and previous_close is not None:
                change = current_price - previous_close
                change_percent = (change / previous_close) * 100 if previous_close != 0 else 0.0
            else:
                change = None
                change_percent = None

            # Get timestamp
            timestamp = meta.get("regularMarketTime")
            if timestamp:
                timestamp = datetime.fromtimestamp(timestamp, timezone.utc).isoformat().replace("+00:00", "Z")  # noqa: DTZ006

            return {
                "symbol": symbol.upper(),
                "price": current_price,
                "previous_close": previous_close,
                "change": round(change, 2) if change is not None else None,
                "change_percent": round(change_percent, 2) if change_percent is not None else None,
                "currency": currency,
                "market_state": market_state,
                "timezone": tz_name,
                "timestamp": timestamp,
                "source": "yahoo_finance",
            }
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return {"error": f"Symbol {symbol} not found"}
        body_text = exc.read().decode(errors="replace")[:200]
        return {"error": f"HTTP {exc.code}: {body_text}"}
    except urllib.error.URLError as exc:
        return {"error": f"Network error: {exc.reason}"}
    except Exception as exc:
        return {"error": f"Failed to fetch quote: {exc}"}


def _fetch_finnhub_quote(symbol: str, api_key: str) -> dict:
    """
    Fetch a stock quote from Finnhub API.

    Returns dict with price data or error message.
    Note: Finnhub doesn't support mutual funds well.
    """
    url = f"{FINNHUB_API_BASE}/quote?symbol={symbol}&token={api_key}"
    req = urllib.request.Request(url)

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())

            # Check if data is valid
            current_price = data.get("c")
            if current_price == 0:
                return {"error": f"No data found for symbol {symbol} (may not be supported by Finnhub)"}

            previous_close = data.get("pc")
            change = data.get("d")
            change_percent = data.get("dp")

            # Get current timestamp
            timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

            return {
                "symbol": symbol.upper(),
                "price": current_price,
                "previous_close": previous_close,
                "change": change,
                "change_percent": change_percent,
                "currency": "USD",
                "market_state": "REGULAR",
                "timezone": "America/New_York",
                "timestamp": timestamp,
                "source": "finnhub",
            }
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            return {"error": "Invalid Finnhub API key"}
        body_text = exc.read().decode(errors="replace")[:200]
        return {"error": f"HTTP {exc.code}: {body_text}"}
    except urllib.error.URLError as exc:
        return {"error": f"Network error: {exc.reason}"}
    except Exception as exc:
        return {"error": f"Failed to fetch quote: {exc}"}


def get_stock_quote(symbol: str) -> dict:
    """
    Get a stock quote for a single symbol.

    Uses Finnhub if FINNHUB_API_KEY is set, otherwise uses Yahoo Finance.
    Yahoo Finance works for stocks, ETFs, and mutual funds.
    Finnhub works best for stocks and ETFs only.
    """
    symbol = symbol.strip().upper()
    if not symbol:
        return {"error": "Symbol is required"}

    # Use Finnhub if API key is available
    api_key = _get_finnhub_api_key()
    if api_key:
        result = _fetch_finnhub_quote(symbol, api_key)
        # If Finnhub fails, fall back to Yahoo Finance
        if "error" in result:
            print(f"Finnhub failed, falling back to Yahoo Finance: {result['error']}", file=sys.stderr)
            return _fetch_yahoo_quote(symbol)
        return result

    # Default to Yahoo Finance
    return _fetch_yahoo_quote(symbol)


def get_stock_quotes(symbols: list[str]) -> dict:
    """
    Get stock quotes for multiple symbols.

    Returns a dict with 'quotes' (list of quote dicts) and 'errors' (list of failed symbols).
    """
    if not symbols:
        return {"error": "At least one symbol is required"}

    quotes = []
    errors = []

    for symbol in symbols:
        result = get_stock_quote(symbol)
        if "error" in result:
            errors.append({"symbol": symbol.upper(), "error": result["error"]})
        else:
            quotes.append(result)

    return {
        "quotes": quotes,
        "errors": errors if errors else None,
        "count": len(quotes),
    }
