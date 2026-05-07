# Stock Quotes Plugin

Fetch current quotes for stocks, ETFs, and mutual funds. The plugin supports both single-symbol lookups and batch requests, which makes it useful for quick price checks as well as portfolio snapshots.

**Pure TypeScript implementation** — no Python runtime required.

## Tools

| Tool | Description |
|------|-------------|
| `stock_quote` | Get the latest quote for one symbol |
| `stock_quotes` | Get the latest quotes for multiple symbols in one request |

## Response Shape

Successful quotes include the symbol, current price, previous close, absolute and percent change, currency, market state, timestamp, and source. Batch requests return a `quotes` array plus an `errors` array for any symbols that could not be fetched.

## Configuration Schema

```json
{
  "finnhubApiKey": "your-finnhub-api-key"
}
```

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `finnhubApiKey` | string | No | Finnhub API key for premium data |

## Example config

Set options in `plugins.entries["stock-quotes"].config`:

```json
{
  "plugins": {
    "entries": {
      "stock-quotes": {
        "enabled": true,
        "config": {
          "finnhubApiKey": "your-finnhub-api-key"
        }
      }
    }
  }
}
```

### Default behavior

The plugin works out of the box with no configuration. It fetches stocks, ETFs, and mutual funds from Yahoo Finance without requiring an API key. If `finnhubApiKey` is configured, the plugin tries Finnhub first and falls back to Yahoo Finance automatically.

## Notes

- Mutual funds may return the latest available NAV rather than an intraday market price.
- Batch requests fetch all symbols in parallel for speed.
- Missing or invalid symbols are returned as explicit errors rather than being silently dropped.

## Development

### Build

```bash
npm run build --workspace=plugins/stock-quotes
```
