# 🛰️ Octo Satellite Plugin

OpenClaw plugin providing structured access to the [Octo Satellite](https://github.com/JeffSteinbok/octo-satellite) service — a local secrets broker that handles credentialed access to Amazon and Monarch Money without exposing passwords or session cookies to the gateway.

## Tools

| Tool | Description |
|------|-------------|
| [`amazon_list_orders`](#tool-amazon_list_orders) | List or search Amazon orders with pagination (10 per page) |
| [`amazon_get_order`](#tool-amazon_get_order) | Get full order details including tracking info |
| [`amazon_search`](#tool-amazon_search) | Search Amazon product catalog |
| [`amazon_get_product`](#tool-amazon_get_product) | Get product details by ASIN |
| [`amazon_get_cart`](#tool-amazon_get_cart) | View current Amazon cart contents |
| [`amazon_add_to_cart`](#tool-amazon_add_to_cart) | Add item to Amazon cart by ASIN |
| [`amazon_remove_from_cart`](#tool-amazon_remove_from_cart) | Remove item from Amazon cart |
| [`monarch_get_accounts`](#tool-monarch_get_accounts) | List financial accounts grouped by type with balances |
| [`monarch_get_net_worth`](#tool-monarch_get_net_worth) | Get current net worth summary or daily history |
| [`monarch_get_spending`](#tool-monarch_get_spending) | Get spending trends by month or date range |
| [`monarch_get_merchants`](#tool-monarch_get_merchants) | Get aggregate spending totals by merchant |
| [`monarch_login`](#tool-monarch_login) | Start interactive Monarch login on the satellite |
| [`monarch_get_health`](#tool-monarch_get_health) | Verify Monarch session is authenticated |
| [`monarch_get_sync_status`](#tool-monarch_get_sync_status) | Get sync status for all linked accounts |
| [`monarch_get_investments`](#tool-monarch_get_investments) | Get investment account positions (holdings) |
| [`monarch_refresh_accounts`](#tool-monarch_refresh_accounts) | Trigger an account refresh with all institutions |

## Configuration Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | string | Yes | Satellite API bearer token |
| `baseUrl` | string | No | Satellite proxy URL (default: `http://localhost:9000`) |

## Example config

Set Octo Satellite under `plugins.entries["octo-satellite"].config`:

```json
{
  "plugins": {
    "entries": {
      "octo-satellite": {
        "enabled": true,
        "config": {
          "token": "${OCTO_SATELLITE_TOKEN}",
          "baseUrl": "http://localhost:9000"
        }
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OCTO_SATELLITE_TOKEN` | Yes | Bearer token for authenticating with the satellite service |

## Tool Parameters

<a id="tool-amazon_list_orders"></a>

### `amazon_list_orders`

- `q` — optional search query to filter orders
- `page` — optional page number, 1-based (default: 1, 10 orders per page)

<a id="tool-amazon_get_order"></a>

### `amazon_get_order`

- `order_id` — required Amazon order ID (e.g. `113-1234567-8901234`)

<a id="tool-amazon_search"></a>

### `amazon_search`

- `q` — required search query
- `page` — optional page number, 1-based (default: 1)

<a id="tool-amazon_get_product"></a>

### `amazon_get_product`

- `asin` — required Amazon product identifier (e.g. `B0FQFB8FMG`)

<a id="tool-amazon_get_cart"></a>

### `amazon_get_cart`

No parameters.

<a id="tool-amazon_add_to_cart"></a>

### `amazon_add_to_cart`

- `asin` — required Amazon product identifier (e.g. `B0FQFB8FMG`)

<a id="tool-amazon_remove_from_cart"></a>

### `amazon_remove_from_cart`

- `item_id` — required cart item ID (from `amazon_get_cart` response)

<a id="tool-monarch_get_accounts"></a>

### `monarch_get_accounts`

No parameters. Returns accounts grouped by type (Investments, Cash, Credit Cards, etc.) with name, balance, institution, and last updated timestamp.

<a id="tool-monarch_get_net_worth"></a>

### `monarch_get_net_worth`

- `start_date` — optional range start date (`YYYY-MM-DD`)
- `end_date` — optional range end date (`YYYY-MM-DD`, defaults to today)

Without dates, returns the current total assets, total liabilities, and net worth. With a start date, returns daily snapshot history.

<a id="tool-monarch_get_spending"></a>

### `monarch_get_spending`

- `months` — optional number of months to look back (default: 3)
- `start_date` — optional range start date (`YYYY-MM-DD`); takes precedence over `months`
- `end_date` — optional range end date (`YYYY-MM-DD`, defaults to today)

Use either `months` or an explicit date range.

<a id="tool-monarch_get_merchants"></a>

### `monarch_get_merchants`

- `months` — optional number of months to look back (default: 3)
- `start_date` — optional range start date (`YYYY-MM-DD`); takes precedence over `months`
- `end_date` — optional range end date (`YYYY-MM-DD`, defaults to today)
- `category` — optional category or category-group filter
- `limit` — optional maximum number of merchants to return

Returns aggregate spending totals by merchant, without transaction details.

<a id="tool-monarch_login"></a>

### `monarch_login`

No parameters. Starts an interactive login on the satellite server; the server terminal prompts for email, password, and MFA.

<a id="tool-monarch_get_health"></a>

### `monarch_get_health`

No parameters. Returns the authentication status of the Monarch Money session.

<a id="tool-monarch_get_sync_status"></a>

### `monarch_get_sync_status`

No parameters. Returns sync status for all linked accounts — last synced time, institution health, and connection state.

<a id="tool-monarch_get_investments"></a>

### `monarch_get_investments`

- `account_id` — optional Monarch account ID to filter to a single investment account. Omit to return positions for all investment accounts. Returns positions with ticker, shares, value, and cost basis.

<a id="tool-monarch_refresh_accounts"></a>

### `monarch_refresh_accounts`

No parameters. Triggers an account refresh with all linked institutions. Fire-and-forget — returns immediately after requesting the refresh. Use `monarch_get_sync_status` to check progress.

## Notes

- The satellite service must be running before using this plugin.
- Amazon access is browser-automated via Playwright on the satellite side — interactive login required on first use.
- Monarch Money uses API-based access via a stored token at `~/.config/octo-satellite/monarch/token.txt`.

## Plugin Structure

```
openclaw.plugin.json
src/index.ts
dist/index.js
```

---

## CLI

Built with [Carapace Plugin SDK](https://github.com/JeffSteinbok/carapace-plugin-sdk).
