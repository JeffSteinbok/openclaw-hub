#!/usr/bin/env python3
"""
OpenClaw plugin tools wrapper for the Withings Health API.

OAuth2 flow:
  1. withings_auth_url  → returns the URL to open in a browser
  2. withings_auth_complete(code) → exchanges code for tokens, stores them

Data tools (all require a linked account):
  - withings_get_measurements  → weight, fat, BMI, blood pressure, heart rate, etc.
  - withings_get_activity      → steps, calories, distance, active minutes
  - withings_get_sleep         → sleep summary (duration, quality scores, phases)
  - withings_get_heart         → ECG / heart rate measurements

Environment variables required:
  WITHINGS_CLIENT_ID     – OAuth2 App Client ID
  WITHINGS_CLIENT_SECRET – OAuth2 App Client Secret

Token storage: ~/.openclaw/withings_tokens.json
"""

import hashlib
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

CLIENT_ID = os.environ.get("WITHINGS_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("WITHINGS_CLIENT_SECRET", "")

# The redirect URI that Withings will call back to.
# Must be registered in your Withings developer app.
REDIRECT_URI = os.environ.get(
    "WITHINGS_REDIRECT_URI",
    "http://localhost:18789/plugins/withings/oauth/callback"
)

TOKEN_FILE = Path.home() / ".openclaw" / "withings_tokens.json"

AUTH_BASE = "https://account.withings.com/oauth2_user/authorize2"
TOKEN_URL = "https://wbsapi.withings.net/v2/oauth2"
API_BASE  = "https://wbsapi.withings.net"

SCOPES = "user.info,user.metrics,user.activity"

# ---------------------------------------------------------------------------
# Token storage helpers
# ---------------------------------------------------------------------------

def _load_tokens() -> dict:
    if TOKEN_FILE.exists():
        try:
            return json.loads(TOKEN_FILE.read_text())
        except Exception:
            pass
    return {}


def _save_tokens(tokens: dict) -> None:
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_FILE.write_text(json.dumps(tokens, indent=2))


def _preflight() -> list[str]:
    errors = []
    if not CLIENT_ID:
        errors.append("WITHINGS_CLIENT_ID is not set.")
    if not CLIENT_SECRET:
        errors.append("WITHINGS_CLIENT_SECRET is not set.")
    return errors

# ---------------------------------------------------------------------------
# OAuth2 helpers
# ---------------------------------------------------------------------------

def _exchange_code(code: str) -> dict:
    """Exchange an auth code for access + refresh tokens."""
    payload = urllib.parse.urlencode({
        "action": "requesttoken",
        "grant_type": "authorization_code",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "code": code,
        "redirect_uri": REDIRECT_URI,
    }).encode()

    req = urllib.request.Request(TOKEN_URL, data=payload, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode())

    if data.get("status") != 0:
        raise RuntimeError(f"Token exchange failed: {data}")

    body = data["body"]
    tokens = {
        "access_token": body["access_token"],
        "refresh_token": body["refresh_token"],
        "expires_at": time.time() + body.get("expires_in", 10800),
        "userid": body.get("userid"),
    }
    _save_tokens(tokens)
    return tokens


def _refresh_tokens(tokens: dict) -> dict:
    """Refresh an expired access token."""
    payload = urllib.parse.urlencode({
        "action": "refreshaccesstoken",
        "grant_type": "refresh_token",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "refresh_token": tokens["refresh_token"],
    }).encode()

    req = urllib.request.Request(TOKEN_URL, data=payload, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode())

    if data.get("status") != 0:
        raise RuntimeError(f"Token refresh failed: {data}")

    body = data["body"]
    tokens["access_token"] = body["access_token"]
    tokens["refresh_token"] = body.get("refresh_token", tokens["refresh_token"])
    tokens["expires_at"] = time.time() + body.get("expires_in", 10800)
    _save_tokens(tokens)
    return tokens


def _get_access_token() -> str:
    """Return a valid access token, refreshing if necessary."""
    tokens = _load_tokens()
    if not tokens:
        raise RuntimeError(
            "No Withings account linked. Use withings_auth_url to start the OAuth flow."
        )
    if time.time() >= tokens.get("expires_at", 0) - 60:
        tokens = _refresh_tokens(tokens)
    return tokens["access_token"]


def _api_get(path: str, params: dict | None = None, timeout: int = 30) -> dict:
    """GET {API_BASE}{path} with bearer auth."""
    token = _get_access_token()
    url = f"{API_BASE}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())
        if data.get("status") != 0:
            return {"error": f"API error {data.get('status')}", "raw": data}
        return {"output": data.get("body", {})}
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}: {e.reason}", "url": url}
    except Exception as e:
        return {"error": str(e)}


def _api_post(path: str, params: dict, timeout: int = 30) -> dict:
    """POST {API_BASE}{path} with bearer auth and form body."""
    token = _get_access_token()
    url = f"{API_BASE}{path}"
    payload = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())
        if data.get("status") != 0:
            return {"error": f"API error {data.get('status')}", "raw": data}
        return {"output": data.get("body", {})}
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}: {e.reason}", "url": url}
    except Exception as e:
        return {"error": str(e)}

# ---------------------------------------------------------------------------
# Measurement type map
# ---------------------------------------------------------------------------

MEAS_TYPES = {
    1:  "Weight (kg)",
    4:  "Height (m)",
    5:  "Fat-free mass (kg)",
    6:  "Fat ratio (%)",
    8:  "Fat mass weight (kg)",
    9:  "Diastolic BP (mmHg)",
    10: "Systolic BP (mmHg)",
    11: "Heart pulse (bpm)",
    12: "Temperature (°C)",
    54: "SPO2 (%)",
    71: "Body temperature (°C)",
    73: "Skin temperature (°C)",
    76: "Muscle mass (kg)",
    77: "Hydration (kg)",
    88: "Bone mass (kg)",
    91: "Pulse wave velocity (m/s)",
    123: "VO2 max (mL/kg/min)",
    135: "QRS duration (ms)",
    136: "PR duration (ms)",
    137: "QT duration (ms)",
    138: "Corrected QT duration (ms)",
    139: "Atrial fibrillation (detected=1)",
}

# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------

def withings_auth_url(args: dict) -> dict:
    """Generate the Withings OAuth2 authorization URL."""
    errors = _preflight()
    if errors:
        return {"error": "Configuration incomplete", "details": errors}

    state = secrets.token_urlsafe(16)
    params = {
        "response_type": "code",
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
        "state": state,
    }
    url = AUTH_BASE + "?" + urllib.parse.urlencode(params)
    return {
        "url": url,
        "state": state,
        "redirect_uri": REDIRECT_URI,
        "instructions": (
            "Open the URL in your browser. After authorizing, Withings will redirect "
            f"to {REDIRECT_URI}?code=<CODE>&state={state}. "
            "Copy the 'code' value and call withings_auth_complete with it."
        ),
    }


def withings_auth_complete(args: dict) -> dict:
    """Exchange an authorization code for tokens and store them."""
    errors = _preflight()
    if errors:
        return {"error": "Configuration incomplete", "details": errors}

    code = args.get("code", "").strip()
    if not code:
        return {"error": "Missing 'code' argument."}

    try:
        tokens = _exchange_code(code)
        return {
            "success": True,
            "userid": tokens.get("userid"),
            "expires_at": datetime.fromtimestamp(tokens["expires_at"], tz=timezone.utc).isoformat(),
            "message": "Withings account linked successfully. Tokens saved.",
        }
    except Exception as e:
        return {"error": str(e)}


def withings_auth_status(args: dict) -> dict:
    """Check whether a Withings account is linked and token is valid."""
    tokens = _load_tokens()
    if not tokens:
        return {"linked": False, "message": "No account linked. Run withings_auth_url to connect."}
    expired = time.time() >= tokens.get("expires_at", 0) - 60
    return {
        "linked": True,
        "userid": tokens.get("userid"),
        "expires_at": datetime.fromtimestamp(tokens["expires_at"], tz=timezone.utc).isoformat(),
        "needs_refresh": expired,
    }


def withings_get_measurements(args: dict) -> dict:
    """
    Fetch body measurements (weight, body composition, BP, heart rate, etc.)
    from Withings. Optional: days_back (default 7), meastypes (comma-separated type IDs).
    """
    days_back = int(args.get("days_back", 7))
    start_ts = int((datetime.now(tz=timezone.utc) - timedelta(days=days_back)).timestamp())

    params: dict = {
        "action": "getmeas",
        "startdate": start_ts,
        "category": 1,  # 1=real measurements, 2=user objectives
    }
    meastypes = args.get("meastypes", "")
    if meastypes:
        params["meastypes"] = meastypes

    result = _api_post("/measure", params)
    if "error" in result:
        return result

    body = result["output"]
    groups = body.get("measuregrps", [])
    out = []
    for grp in groups:
        dt = datetime.fromtimestamp(grp["date"], tz=timezone.utc).isoformat()
        measures = []
        for m in grp.get("measures", []):
            value = m["value"] * (10 ** m["unit"])
            label = MEAS_TYPES.get(m["type"], f"type_{m['type']}")
            measures.append({"type": label, "value": round(value, 4)})
        out.append({"timestamp": dt, "measures": measures})

    return {"measurements": out, "count": len(out)}


def withings_get_activity(args: dict) -> dict:
    """
    Fetch daily activity summaries (steps, calories, distance, active minutes).
    Optional: days_back (default 7).
    """
    days_back = int(args.get("days_back", 7))
    start_date = (datetime.now(tz=timezone.utc) - timedelta(days=days_back)).strftime("%Y-%m-%d")
    end_date = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d")

    params = {
        "action": "getactivity",
        "startdateymd": start_date,
        "enddateymd": end_date,
        "data_fields": "steps,distance,totalcalories,active,soft,moderate,intense",
    }

    result = _api_get("/v2/measure", params)
    if "error" in result:
        return result

    activities = result["output"].get("activities", [])
    return {"activities": activities, "count": len(activities)}


def withings_get_sleep(args: dict) -> dict:
    """
    Fetch sleep summary data (total sleep, REM, deep sleep, light sleep, wake).
    Optional: days_back (default 7).
    """
    days_back = int(args.get("days_back", 7))
    start_ts = int((datetime.now(tz=timezone.utc) - timedelta(days=days_back)).timestamp())
    end_ts = int(datetime.now(tz=timezone.utc).timestamp())

    params = {
        "action": "getsummary",
        "startdateymd": (datetime.now(tz=timezone.utc) - timedelta(days=days_back)).strftime("%Y-%m-%d"),
        "enddateymd": datetime.now(tz=timezone.utc).strftime("%Y-%m-%d"),
        "data_fields": (
            "nb_rem_episodes,sleep_score,snoring,snoring_episode_count,"
            "sleep_efficiency,total_sleep_time,total_timeinbed,"
            "wakeup_count,wakeuprestorations_count,deepsleepduration,"
            "lightsleepduration,remsleepduration,wakeupduration"
        ),
    }

    result = _api_get("/v2/sleep", params)
    if "error" in result:
        return result

    series = result["output"].get("series", [])
    out = []
    for s in series:
        entry = {
            "date": s.get("date"),
            "startdate": datetime.fromtimestamp(s["startdate"], tz=timezone.utc).isoformat() if "startdate" in s else None,
            "enddate": datetime.fromtimestamp(s["enddate"], tz=timezone.utc).isoformat() if "enddate" in s else None,
        }
        entry.update(s.get("data", {}))
        out.append(entry)

    return {"sleep_summaries": out, "count": len(out)}


def withings_get_heart(args: dict) -> dict:
    """
    Fetch heart rate / ECG list from Withings.
    Optional: days_back (default 7).
    """
    days_back = int(args.get("days_back", 7))
    start_ts = int((datetime.now(tz=timezone.utc) - timedelta(days=days_back)).timestamp())
    end_ts = int(datetime.now(tz=timezone.utc).timestamp())

    params = {
        "action": "list",
        "startdate": start_ts,
        "enddate": end_ts,
    }

    result = _api_get("/v2/heart", params)
    if "error" in result:
        return result

    series = result["output"].get("series", [])
    out = []
    for s in series:
        out.append({
            "timestamp": datetime.fromtimestamp(s["timestamp"], tz=timezone.utc).isoformat(),
            "heart_rate": s.get("heart_rate", {}).get("value"),
            "ecg": "available" if s.get("ecg") else None,
            "afib_classification": s.get("afib", {}).get("afib_classification"),
        })

    return {"heart_records": out, "count": len(out)}


# ---------------------------------------------------------------------------
# Dispatch table
# ---------------------------------------------------------------------------

TOOLS = {
    "withings_auth_url": withings_auth_url,
    "withings_auth_complete": withings_auth_complete,
    "withings_auth_status": withings_auth_status,
    "withings_get_measurements": withings_get_measurements,
    "withings_get_activity": withings_get_activity,
    "withings_get_sleep": withings_get_sleep,
    "withings_get_heart": withings_get_heart,
}

MANIFEST = {
    "tools": [
        {
            "name": "withings_auth_url",
            "description": "Generate a Withings OAuth2 authorization URL. Open this URL in a browser to link a Withings account. After authorizing, call withings_auth_complete with the code from the redirect URL.",
            "input_schema": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
        {
            "name": "withings_auth_complete",
            "description": "Complete Withings OAuth2 flow by exchanging the authorization code for tokens. Pass the 'code' query parameter from the redirect URL.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "The authorization code from the Withings redirect URL.",
                    }
                },
                "required": ["code"],
                "additionalProperties": False,
            },
        },
        {
            "name": "withings_auth_status",
            "description": "Check whether a Withings account is currently linked and whether the access token is valid.",
            "input_schema": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
        {
            "name": "withings_get_measurements",
            "description": "Fetch body measurements from Withings: weight, body fat %, BMI, blood pressure, heart rate, and more.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "days_back": {
                        "type": "integer",
                        "description": "How many days of history to fetch (default: 7).",
                    },
                    "meastypes": {
                        "type": "string",
                        "description": "Optional comma-separated Withings measurement type IDs to filter (e.g. '1,6' for weight and fat ratio).",
                    },
                },
                "additionalProperties": False,
            },
        },
        {
            "name": "withings_get_activity",
            "description": "Fetch daily activity summaries from Withings: steps, distance, calories, and active/light/moderate/intense minutes.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "days_back": {
                        "type": "integer",
                        "description": "How many days of history to fetch (default: 7).",
                    },
                },
                "additionalProperties": False,
            },
        },
        {
            "name": "withings_get_sleep",
            "description": "Fetch sleep summary data from Withings: total sleep time, REM, deep sleep, light sleep, sleep score, snoring, and wake count.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "days_back": {
                        "type": "integer",
                        "description": "How many days of history to fetch (default: 7).",
                    },
                },
                "additionalProperties": False,
            },
        },
        {
            "name": "withings_get_heart",
            "description": "Fetch heart rate and ECG records from Withings, including AFib classification where available.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "days_back": {
                        "type": "integer",
                        "description": "How many days of history to fetch (default: 7).",
                    },
                },
                "additionalProperties": False,
            },
        },
    ]
}

# ---------------------------------------------------------------------------
# Entry point (stdin/stdout JSON protocol)
# ---------------------------------------------------------------------------

def main():
    payload = json.loads(sys.stdin.read())
    method = payload.get("method")

    if method == "manifest":
        print(json.dumps(MANIFEST))
        return

    if method == "call":
        tool_name = payload.get("tool")
        args = payload.get("args", {})
        fn = TOOLS.get(tool_name)
        if fn is None:
            print(json.dumps({"error": f"Unknown tool: {tool_name}"}))
            return
        try:
            result = fn(args)
        except Exception as e:
            result = {"error": str(e)}
        print(json.dumps(result))
        return

    print(json.dumps({"error": f"Unknown method: {method}"}))


if __name__ == "__main__":
    main()
