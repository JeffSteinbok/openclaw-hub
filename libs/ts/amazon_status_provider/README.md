# Amazon Status Provider

Carrier status provider for Amazon packages. Fetches order details via the
[Octo Satellite](../../plugins/octo-satellite/) local proxy, which maintains
an authenticated session with Amazon.

## How it works

1. When a package is added with `package_add`, store the Amazon **order ID**
   alongside the **TBA tracking number**.
2. On `get_package_status`, the provider reads the stored `order_id`, calls
   `GET /amazon/orders/:id` on the satellite proxy, and maps the response
   to a `CarrierStatusResult`.

## Prerequisites

- Octo Satellite must be running locally (default: `http://localhost:9000`)
- Satellite must have a valid Amazon session

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `SATELLITE_BASE_URL` | `http://localhost:9000` | Satellite proxy URL |
| `SATELLITE_TOKEN` | _(none)_ | Optional bearer token |

## Wiring it up

Add to `openclaw.json`:

```json
{
  "plugin": "package-tracking",
  "config": {
    "status_providers": [
      "/path/to/openclaw-hub/libs/ts/amazon_status_provider/dist/index.js"
    ]
  }
}
```

## Adding an Amazon package

```
package_add(
  tracking_number="TBA123456789012US",
  carrier="Amazon",
  order_id="113-1234567-8901234",
  label="USB-C cables"
)
```

The `order_id` is stored in the tracking JSON and used by this provider
to look up delivery status.

## Building

```bash
npm install
npm run build
npm test         # 6 unit tests
```
