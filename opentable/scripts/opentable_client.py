"""OpenTable client for searching restaurants and checking availability.

Uses OpenTable's GraphQL endpoint (/dapi/fe/gql) with:
- curl_cffi for Chrome TLS fingerprint impersonation (bypasses Akamai bot protection)
- CSRF token extracted from homepage
- Persisted query hashes for the GraphQL operations

No auth/login required. Relies on undocumented internal APIs that may change.
"""

import os
import sys
import json
import re
import requests as plain_requests

try:
    from curl_cffi import requests as cffi_requests
    HAS_CURL_CFFI = True
except ImportError:
    HAS_CURL_CFFI = False

OPENTABLE_GQL_URL = "https://www.opentable.com/dapi/fe/gql"
OPENTABLE_BOOKING_BASE = "https://www.opentable.com/booking/experiences-availability"

# Last known working persisted-query hash for the RestaurantsAvailability
# GraphQL operation.  This is a server-side registered hash that is NOT
# embedded in any client JS bundle, so it cannot be auto-detected.
# Override via the OPENTABLE_AVAILABILITY_HASH environment variable.
_DEFAULT_HASH = "b2d05a06151b3cb21d9dfce4f021303eeba288fac347068b29c1cb66badc46af"


def get_availability_hash():
    """Return the persisted query hash, preferring an env-var override."""
    return os.environ.get("OPENTABLE_AVAILABILITY_HASH", _DEFAULT_HASH)


class OpenTableSession:
    """Manages a session with CSRF token for OpenTable GraphQL queries."""

    def __init__(self):
        self.csrf_token = None
        self.session = None
        self._init_session()

    def _init_session(self):
        if HAS_CURL_CFFI:
            self.session = cffi_requests.Session(impersonate="chrome")
        else:
            self.session = plain_requests.Session()
            self.session.headers.update({
                "User-Agent": "curl/7.74.0",
            })

    def _ensure_csrf(self):
        """Load OpenTable homepage to extract CSRF token."""
        if self.csrf_token:
            return True

        try:
            resp = self.session.get("https://www.opentable.com/", timeout=25)
            if resp.status_code != 200:
                return False
            match = re.search(r'"__CSRF_TOKEN__":"([^"]+)"', resp.text)
            if match:
                self.csrf_token = match.group(1)
                return True
        except Exception:
            pass
        return False

    def _gql_request(self, operation_name, variables, sha256_hash):
        """Make a GraphQL request to OpenTable."""
        if not self._ensure_csrf():
            return {"error": "Failed to obtain CSRF token from OpenTable"}

        payload = {
            "operationName": operation_name,
            "variables": variables,
            "extensions": {
                "persistedQuery": {
                    "version": 1,
                    "sha256Hash": sha256_hash,
                }
            }
        }

        try:
            resp = self.session.post(
                f"{OPENTABLE_GQL_URL}?optype=query&opname={operation_name}",
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "Origin": "https://www.opentable.com",
                    "Referer": "https://www.opentable.com/",
                    "x-csrf-token": self.csrf_token,
                },
                timeout=20,
            )
            if resp.status_code == 200:
                return resp.json()
            else:
                return {"error": f"OpenTable returned {resp.status_code}: {resp.text[:200]}"}
        except Exception as e:
            return {"error": f"OpenTable request failed: {e}"}


# Module-level session (reused across calls)
_session = None


def _get_session():
    global _session
    if _session is None:
        _session = OpenTableSession()
    return _session


def get_restaurant_id(restaurant_slug):
    """Get restaurant ID from a restaurant page URL slug.

    Args:
        restaurant_slug: e.g. "carbone-new-york" from opentable.com/r/carbone-new-york
    """
    try:
        # Use plain requests with curl UA — gets SSR page with embedded data
        resp = plain_requests.get(
            f"https://www.opentable.com/r/{restaurant_slug}",
            headers={"User-Agent": "curl/7.74.0"},
            timeout=15,
        )
        if resp.status_code != 200:
            return {"error": f"Restaurant page returned {resp.status_code}"}

        # Extract from primary-window-vars
        pwv = re.search(r'<script\s+id="primary-window-vars"[^>]*>(.*?)</script>', resp.text, re.DOTALL)
        if pwv:
            data = json.loads(pwv.group(1))
            wv = data.get("windowVariables", {})
            ga = wv.get("__OT_GA_DATA__", {})
            rid = ga.get("cd6")
            name = ga.get("cd1", restaurant_slug)
            if rid:
                return {"restaurant_id": int(rid), "name": name, "slug": restaurant_slug}

        # Fallback: search for restaurantId in page
        rid_match = re.search(r'"restaurantId"\s*:\s*(\d+)', resp.text)
        if rid_match:
            return {"restaurant_id": int(rid_match.group(1)), "slug": restaurant_slug}

        return {"error": "Could not extract restaurant ID from page"}
    except Exception as e:
        return {"error": f"Failed to load restaurant page: {e}"}


def search_restaurants(query, location, limit=10):
    """Search OpenTable restaurants.

    OpenTable's GraphQL API doesn't expose a text search operation.
    Use 'lookup' with a restaurant URL slug instead.
    """
    return {
        "results": [],
        "count": 0,
        "note": "OpenTable doesn't expose a text search API. Use 'lookup' with a restaurant URL slug instead (e.g., 'carbone-new-york' from opentable.com/r/carbone-new-york).",
    }


def check_availability(restaurant_id, date, party_size=2, time="19:00"):
    """Check available time slots on OpenTable.

    Args:
        restaurant_id: OpenTable restaurant ID (integer)
        date: Date string YYYY-MM-DD
        party_size: Number of guests
        time: Preferred time HH:MM (default 19:00)
    """
    if not HAS_CURL_CFFI:
        return {"error": "curl_cffi package required for OpenTable. Install with: pip install curl_cffi"}

    session = _get_session()
    variables = {
        "restaurantIds": [int(restaurant_id)],
        "date": date,
        "time": time,
        "partySize": int(party_size),
        "databaseRegion": "NA",
    }

    data = session._gql_request("RestaurantsAvailability", variables, get_availability_hash())

    if "error" in data:
        return data

    # Parse the GraphQL response
    try:
        availability = data.get("data", {}).get("availability", [])
        if not availability:
            return {"slots": [], "message": "No availability data returned"}

        restaurant = availability[0]
        if restaurant is None:
            return {"slots": [], "message": "Restaurant not found or no availability on OpenTable"}
        days = restaurant.get("availabilityDays", [])
        if not days:
            return {"slots": [], "message": "No availability for this date"}

        day = days[0]
        raw_slots = day.get("slots", [])
        slots = []
        for s in raw_slots:
            if s.get("isAvailable"):
                # Calculate actual time from offset
                base_hour, base_min = map(int, time.split(":"))
                total_minutes = base_hour * 60 + base_min + s.get("timeOffsetMinutes", 0)
                slot_hour = total_minutes // 60
                slot_min = total_minutes % 60
                slot_time = f"{slot_hour:02d}:{slot_min:02d}"

                slots.append({
                    "slot_id": s.get("slotHash", ""),
                    "time": slot_time,
                    "type": s.get("type", "Standard"),
                    "seating": s.get("attributes", []),
                    "booking_url": build_booking_url(restaurant_id, date, slot_time, party_size),
                })

        return {"slots": slots, "count": len(slots)}
    except Exception as e:
        return {"error": f"Failed to parse availability: {e}"}


def build_booking_url(restaurant_id, date, time, party_size):
    """Build an OpenTable booking URL."""
    from urllib.parse import urlencode
    params = {
        "rid": str(restaurant_id),
        "datetime": f"{date}T{time}",
        "covers": str(party_size),
    }
    return f"{OPENTABLE_BOOKING_BASE}?{urlencode(params)}"


def main():
    """CLI interface for testing."""
    if len(sys.argv) < 3:
        print("Usage:")
        print("  python opentable_client.py lookup <restaurant-slug>")
        print("    e.g., python opentable_client.py lookup carbone-new-york")
        print("  python opentable_client.py availability <restaurant_id> <date> [party_size] [time]")
        print("    e.g., python opentable_client.py availability 8033 2026-03-15 2 19:00")
        sys.exit(1)

    command = sys.argv[1]

    if command == "lookup":
        slug = sys.argv[2]
        result = get_restaurant_id(slug)
        print(json.dumps(result, indent=2))

    elif command == "search":
        query = sys.argv[2]
        city = sys.argv[3] if len(sys.argv) > 3 else ""
        result = search_restaurants(query, city)
        print(json.dumps(result, indent=2))

    elif command == "availability":
        rid = int(sys.argv[2])
        date = sys.argv[3]
        party_size = int(sys.argv[4]) if len(sys.argv) > 4 else 2
        time = sys.argv[5] if len(sys.argv) > 5 else "19:00"
        result = check_availability(rid, date, party_size, time)
        print(json.dumps(result, indent=2))

    else:
        print(f"Unknown command: {command}")
        sys.exit(1)


if __name__ == "__main__":
    main()
