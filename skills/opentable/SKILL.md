---
name: opentable
description: Check restaurant availability on OpenTable
version: 1.0.0
requires:
  bins:
    - python
  packages:
    - requests
    - curl_cffi
---

# OpenTable Availability Skill

Check real-time restaurant availability on OpenTable. Query-only — does not make reservations.

## Setup

Install Python dependencies (one-time):

```bash
cd skills/opentable/scripts
pip install -r requirements.txt
```

## Commands

### Look up a restaurant ID from its OpenTable URL slug

```bash
python skills/opentable/scripts/opentable_client.py lookup <restaurant-slug>
```

The slug is the last part of an OpenTable restaurant URL:
`https://www.opentable.com/r/carbone-new-york` → slug is `carbone-new-york`

### Check availability

```bash
python skills/opentable/scripts/opentable_client.py availability <restaurant_id> <date> [party_size] [time]
```

- `restaurant_id`: Integer ID from the lookup command
- `date`: YYYY-MM-DD format
- `party_size`: Number of guests (default: 2)
- `time`: Preferred time in HH:MM (default: 19:00)

## Workflow

When the user asks about OpenTable restaurant availability:

1. If they provide a restaurant name, search opentable.com for the restaurant URL slug
2. Run `lookup` with the slug to get the restaurant ID
3. Run `availability` with the restaurant ID, date, party size, and preferred time
4. Present available time slots in a table with the booking URL for each slot
5. If no slots are available, suggest trying a different date or time

## Example

User: "Is there availability at Dirt Candy in NYC this Saturday for 2 at 7pm?"

Steps:
1. Search opentable.com to find the slug: `dirt-candy-new-york`
2. `python skills/opentable/scripts/opentable_client.py lookup dirt-candy-new-york`
   → Returns `{"restaurant_id": 8033, ...}`
3. `python skills/opentable/scripts/opentable_client.py availability 8033 2026-03-07 2 19:00`
   → Returns available slots

Present results:

| Time  | Type     | Seating     | Book |
|-------|----------|-------------|------|
| 18:30 | Standard | default,bar | [Link](https://www.opentable.com/booking/...) |
| 19:00 | Standard | default     | [Link](https://www.opentable.com/booking/...) |
| 19:30 | Standard | default     | [Link](https://www.opentable.com/booking/...) |

## Notes

- No authentication or API key required
- Uses OpenTable's internal GraphQL API with a persisted query hash
- The hash (`b2d05a06...`) may need updating if OpenTable deploys new frontend code — if availability queries start returning errors, the hash is likely stale
- Override the hash via the `OPENTABLE_AVAILABILITY_HASH` environment variable
- OpenTable does not expose a text search API; restaurant lookup requires the URL slug
- Results include a booking URL — the user completes the reservation on OpenTable's website
- Requires `curl_cffi` Python package for TLS fingerprint impersonation
