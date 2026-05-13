# Withings Plugin for OpenClaw

Connects OpenClaw to your Withings health devices. Fetch body measurements, activity, sleep, and heart rate data via the Withings Health API.

## Tools

| Tool | Description |
|------|-------------|
| [`withings_auth_url`](#tool-withings_auth_url) | Generate an OAuth2 authorization URL to link a Withings account |
| [`withings_auth_complete`](#tool-withings_auth_complete) | Exchange an authorization code for tokens |
| [`withings_auth_status`](#tool-withings_auth_status) | Check whether an account is linked and token refresh is healthy |
| [`withings_get_measurements`](#tool-withings_get_measurements) | Fetch weight, body composition, blood pressure, and related metrics |
| [`withings_get_activity`](#tool-withings_get_activity) | Fetch steps, calories, distance, and activity minutes |
| [`withings_get_sleep`](#tool-withings_get_sleep) | Fetch sleep summary data |
| [`withings_get_heart`](#tool-withings_get_heart) | Fetch heart rate and ECG records |

## Configuration Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `clientId` | string | Optional | Withings OAuth2 App Client ID |
| `clientSecret` | string | Optional | Withings OAuth2 App Client Secret |
| `redirectUri` | string | Optional | OAuth redirect URI registered with the Withings developer app |

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

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `WITHINGS_CLIENT_ID` | No | Backing value for plugin config `clientId` |
| `WITHINGS_CLIENT_SECRET` | No | Backing value for plugin config `clientSecret` |
| `WITHINGS_REDIRECT_URI` | No | Backing value for plugin config `redirectUri` |

## Tool Parameters

<a id="tool-withings_auth_url"></a>

### `withings_auth_url`

- No parameters

<a id="tool-withings_auth_complete"></a>

### `withings_auth_complete`

- `code` — required authorization code from the Withings redirect URL

<a id="tool-withings_auth_status"></a>

### `withings_auth_status`

- No parameters

<a id="tool-withings_get_measurements"></a>

### `withings_get_measurements`

- `days_back` — optional number of days of history to fetch (default `7`)
- `meastypes` — optional comma-separated Withings measurement type IDs

<a id="tool-withings_get_activity"></a>

### `withings_get_activity`

- `days_back` — optional number of days of history to fetch (default `7`)

<a id="tool-withings_get_sleep"></a>

### `withings_get_sleep`

- `days_back` — optional number of days of history to fetch (default `7`)

<a id="tool-withings_get_heart"></a>

### `withings_get_heart`

- `days_back` — optional number of days of history to fetch (default `7`)

## Setup

### 1. Create a Withings developer app

1. Go to <https://developer.withings.com/>
2. Create a new application
3. Set the callback / redirect URL to `http://<your-gateway-host>:18789/plugins/withings/oauth/callback`
4. Copy your App ID and Client Secret

### 2. Enable the plugin

Use the configuration shown above in `openclaw.json`.

### 3. Restart the gateway

```bash
openclaw gateway restart
```

### 4. Link your account

Ask your agent for the Withings auth URL, open it in a browser, then pass the returned `code` to `withings_auth_complete`.

## Notes

- Scopes requested: `user.info`, `user.metrics`, and `user.activity`.
- Tokens are stored at `~/.openclaw/withings_tokens.json`.
- Access tokens refresh automatically using the stored refresh token.

---

## CLI Usage

Built with [Carapace Plugin SDK](https://github.com/JeffSteinbok/carapace-plugin-sdk).

All tools are also available as a standalone CLI:

```bash
cd plugins/withings
npm install && npm run build
node dist/bin/withings.js --help
```

### Example commands

```bash
node dist/bin/withings.js withings-auth-url ...
node dist/bin/withings.js withings-auth-complete ...
node dist/bin/withings.js withings-auth-status ...
node dist/bin/withings.js withings-get-measurements ...
node dist/bin/withings.js withings-get-activity ...
node dist/bin/withings.js withings-get-sleep ...
node dist/bin/withings.js withings-get-heart ...

# JSON output
node dist/bin/withings.js <command> [args...] --json
```

### CLI Environment Variables

| Variable | Description |
|----------|-------------|
| `WITHINGS_CLIENT_ID` | Withings OAuth2 client ID |
| `WITHINGS_CLIENT_SECRET` | Withings OAuth2 client secret |
| `WITHINGS_REDIRECT_URI` | OAuth2 redirect URI |
