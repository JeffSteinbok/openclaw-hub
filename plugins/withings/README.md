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

```
WITHINGS_CLIENT_ID=your_app_id_here
WITHINGS_CLIENT_SECRET=your_client_secret_here
```

### 3. Enable the plugin

In `openclaw.json`:

```json
"withings": {
  "enabled": true,
  "config": {}
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
