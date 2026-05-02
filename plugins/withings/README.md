# Withings Plugin for OpenClaw

Connects OpenClaw to your Withings health devices. Fetches body measurements, activity, sleep, and heart rate data via the Withings Health API.

## Tools

| Tool | Description |
|------|-------------|
| `withings_auth_url` | Generate OAuth2 authorization URL to link a Withings account |
| `withings_auth_complete` | Exchange authorization code for tokens |
| `withings_auth_status` | Check if an account is linked and token is valid |
| `withings_get_measurements` | Weight, body fat, BMI, blood pressure, heart rate |
| `withings_get_activity` | Steps, distance, calories, active minutes |
| `withings_get_sleep` | Sleep duration, REM, deep, light, sleep score, snoring |
| `withings_get_heart` | Heart rate and ECG records with AFib classification |

## Example config

Set Withings under `plugins.entries["withings"].config`:

```json
{
  "plugins": {
    "entries": {
      "withings": {
        "enabled": true,
        "config": {
          "clientId": "${WITHINGS_CLIENT_ID}",
          "clientSecret": "${WITHINGS_CLIENT_SECRET}",
          "redirectUri": "${WITHINGS_REDIRECT_URI}"
        }
      }
    }
  }
}
```

## Configuration Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `clientId` | string | Optional | Withings OAuth2 App Client ID |
| `clientSecret` | string | Optional | Withings OAuth2 App Client Secret |
| `redirectUri` | string | Optional | OAuth redirect URI registered with the Withings developer app |

## Setup

### 1. Create a Withings developer app

1. Go to <https://developer.withings.com/>
2. Create a new application
3. Set the callback / redirect URL to:
   ```
   http://<your-gateway-host>:18789/plugins/withings/oauth/callback
   ```
   Or for local use: `http://localhost:18789/plugins/withings/oauth/callback`
4. Copy your **App ID** (Client ID) and **Client Secret**

### 2. Set environment variables

Add to `~/.openclaw/.env`:

| Variable | Required | Description |
|----------|----------|-------------|
| `WITHINGS_CLIENT_ID` | Yes | Withings OAuth app client ID |
| `WITHINGS_CLIENT_SECRET` | Yes | Withings OAuth app client secret |
| `WITHINGS_REDIRECT_URI` | Yes | OAuth redirect URI registered with the Withings app |

```
WITHINGS_CLIENT_ID=your_app_id_here
WITHINGS_CLIENT_SECRET=your_client_secret_here
WITHINGS_REDIRECT_URI=http://localhost:18789/plugins/withings/oauth/callback
```

### 3. Enable the plugin

Use the configuration shown above in `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "withings": {
        "enabled": true,
        "config": {
          "clientId": "${WITHINGS_CLIENT_ID}",
          "clientSecret": "${WITHINGS_CLIENT_SECRET}",
          "redirectUri": "${WITHINGS_REDIRECT_URI}"
        }
      }
    }
  }
}
```

### 4. Restart the gateway

```
openclaw gateway restart
```

### 5. Link your account

Ask your agent:
> "Get me the Withings auth URL"

Open the URL in a browser, authorize the app, then copy the `code` from the redirect URL and pass it back:
> "Complete Withings auth with code: `<code>`"

## Scopes requested

- `user.info` — basic profile
- `user.metrics` — body measurements
- `user.activity` — steps and activity data

## Token storage

Tokens are stored at `~/.openclaw/withings_tokens.json`. Access tokens refresh automatically using the stored refresh token.
