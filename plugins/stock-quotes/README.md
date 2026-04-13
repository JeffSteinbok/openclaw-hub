# Stock Quotes Plugin

Fetch current quotes for stocks, ETFs, and mutual funds. The plugin supports both single-symbol lookups and batch requests, which makes it useful for quick price checks as well as portfolio snapshots.

## Tools

| Tool | Description |
|------|-------------|
| `stock_quote` | Get the latest quote for one symbol |
| `stock_quotes` | Get the latest quotes for multiple symbols in one request |

## Response Shape

Successful quotes include the symbol, current price, previous close, absolute and percent change, currency, market state, timestamp, and source. Batch requests return a `quotes` array plus an `errors` array for any symbols that could not be fetched.

## Configuration

### Default behavior

The plugin works out of the box with no configuration. It can fetch stocks, ETFs, and mutual funds without requiring an API key.

### Optional environment variables

| Variable | Description |
|----------|-------------|
| `FINNHUB_API_KEY` | Optional Finnhub API key |

If `FINNHUB_API_KEY` is set, the plugin will try Finnhub first and fall back automatically when needed.

## Notes

- Mutual funds may return the latest available NAV rather than an intraday market price.
- Batch requests keep successful quotes even when some symbols fail.
- Missing or invalid symbols are returned as explicit errors rather than being silently dropped.

## Development

### Build

```bash
npm run build --workspace=plugins/stock-quotes
```

### Test

```bash
python3 plugins/stock-quotes/tests/test_tools.py
```
