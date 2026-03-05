# OpenTable Availability Skill

An [OpenClaw](https://github.com/AugustDev/openclaw) skill that checks real-time restaurant availability on OpenTable. Query-only — does not make reservations.

## How It Works

OpenTable doesn't offer a public API, so this skill reverse-engineers their internal GraphQL endpoint (`/dapi/fe/gql`) using two techniques:

1. **TLS Fingerprint Impersonation** — OpenTable's Akamai bot protection blocks standard Python HTTP clients (403). The [`curl_cffi`](https://github.com/yifeikong/curl_cffi) library impersonates Chrome's TLS fingerprint to pass bot detection.

2. **CSRF Token Extraction** — Each request requires an `x-csrf-token` header. The skill loads the OpenTable homepage, extracts the `__CSRF_TOKEN__` from the server-rendered HTML, and attaches it to every GraphQL request.

3. **Persisted Query Hashes** — OpenTable uses Apollo Server persisted queries. Instead of sending raw GraphQL query text, the client sends a `sha256Hash` that the server maps to a registered query. The hash is a server-side value that isn't embedded in client JS bundles.

### Architecture

```
┌─────────────┐      ┌──────────────────┐      ┌─────────────┐
│  OpenClaw    │      │  opentable_      │      │  OpenTable   │
│  Agent       │─────▶│  client.py       │─────▶│  GraphQL API │
│              │      │                  │      │  /dapi/fe/gql│
└─────────────┘      │  • curl_cffi     │      └─────────────┘
                     │  • CSRF tokens   │
                     │  • persisted Qs  │
                     └──────────────────┘
```

## Installation

```bash
pip install requests curl_cffi
```

Or from the `scripts/` directory:

```bash
pip install -r scripts/requirements.txt
```

## Usage

### Look Up a Restaurant

Get a restaurant's numeric ID from its OpenTable URL slug:

```bash
python scripts/opentable_client.py lookup john-howie-steak-bellevue
```

The slug is the last segment of the restaurant's OpenTable URL:
`https://www.opentable.com/r/john-howie-steak-bellevue` → `john-howie-steak-bellevue`

**Output:**
```json
{
  "restaurant_id": 34339,
  "name": "John Howie Steak - Bellevue",
  "slug": "john-howie-steak-bellevue"
}
```

### Check Availability

```bash
python scripts/opentable_client.py availability <restaurant_id> <date> [party_size] [time]
```

| Parameter       | Required | Default | Description              |
|-----------------|----------|---------|--------------------------|
| `restaurant_id` | Yes      | —       | Numeric ID from lookup   |
| `date`          | Yes      | —       | `YYYY-MM-DD`             |
| `party_size`    | No       | 2       | Number of guests         |
| `time`          | No       | 19:00   | Preferred time `HH:MM`   |

**Example:**

```bash
python scripts/opentable_client.py availability 34339 2025-07-20 2 19:00
```

**Output:**
```json
{
  "slots": [
    {
      "time": "18:30",
      "type": "Standard",
      "booking_url": "https://www.opentable.com/booking/..."
    },
    {
      "time": "19:00",
      "type": "Standard",
      "booking_url": "https://www.opentable.com/booking/..."
    }
  ],
  "count": 2
}
```

## Configuration

### Persisted Query Hash

The availability query uses a persisted query hash registered on OpenTable's servers. If OpenTable deploys new frontend code, the hash may become stale and requests will fail.

**To override the hash:**

```bash
export OPENTABLE_AVAILABILITY_HASH="new_hash_here"
```

**To find the current hash:**

1. Open a restaurant page on opentable.com in your browser
2. Open DevTools → Network tab
3. Filter by `RestaurantsAvailability`
4. Change the date/time/party size to trigger a new availability request
5. In the request payload, find `extensions.persistedQuery.sha256Hash`

### Known Hash History

| Hash (prefix) | Source | Status |
|----------------|--------|--------|
| `b2d05a06...` | pick-a repo (2025) | ✅ Working |
| `e6b87021...` | Older version (2023) | ❌ Expired |
| `55b189ad...` | Oldest known (2021) | ❌ Expired |

## Limitations

- **No text search** — OpenTable doesn't expose a restaurant search API. You need the URL slug from opentable.com.
- **Resy-only restaurants** — Some restaurants (e.g., Carbone NYC) use Resy for reservations instead of OpenTable. These will return empty availability.
- **Bot protection** — Requires `curl_cffi` for TLS impersonation. Standard `requests` gets blocked (403).
- **Hash expiration** — The persisted query hash will eventually expire when OpenTable updates their server. See [Configuration](#persisted-query-hash) for how to update it.
- **Region** — Currently hardcoded to `databaseRegion: "NA"` (North America).

## License

MIT
