# fastmail-sse

Real-time email notifications for [OpenClaw](https://openclaw.ai) via Fastmail's JMAP EventSource API.

Connects to Fastmail's SSE stream, watches for new Inbox emails, formats a notification, and delivers it through an OpenClaw agent to your preferred channel (Telegram, Discord, etc.).

## How It Works

```
Fastmail SSE stream
    → Python detects new Inbox email
    → Formats notification (📧 Sender: Subject)
    → Skips spam/marketing (unsubscribe, noreply)
    → openclaw agent --agent <agent> --channel <channel> --deliver
    → You get a notification
```

The Python daemon handles **all** triage and formatting. The OpenClaw agent is a thin delivery relay — it receives a pre-formatted message and passes it through to your channel.

## Prerequisites

- **OpenClaw** installed and gateway running
- **Fastmail** account with an API token
- **An OpenClaw agent** to deliver notifications (see [Agent Setup](#agent-setup))
- **Python 3** (no pip dependencies — stdlib only)

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `FASTMAIL_JMAP_TOKEN` | ✅ | Fastmail API token ([create one here](https://www.fastmail.com/settings/security/tokens)) |
| `FASTMAIL_ACCOUNT_ID` | ✅ | Your JMAP account ID (see [Finding Your IDs](#finding-your-ids)) |
| `FASTMAIL_INBOX_ID` | ✅ | JMAP mailbox ID for your Inbox |
| `NOTIFY_AGENT` | | Agent to deliver notifications (default: `mail-agent`) |
| `NOTIFY_CHANNEL` | | Delivery channel — `telegram`, `discord`, etc. (default: `telegram`) |

Add these to `~/.openclaw/.env` or your systemd `EnvironmentFile`.

## Agent Setup

Create a dedicated agent for mail delivery:

```bash
openclaw agents add --agent mail-agent
```

Give it a minimal `SOUL.md` in its workspace (`~/.openclaw/agents/mail-agent/workspace/SOUL.md`):

```markdown
# Mail Agent

You are the mail delivery agent. You receive pre-formatted email
notifications. Deliver the message exactly as written. Do not
reformat, summarize, or editorialize.
```

The agent needs a model configured (any cheap/fast model works — it's just relaying messages). Copy `auth-profiles.json` from your main agent or configure one.

You can use any existing agent instead — just set `NOTIFY_AGENT` to its ID.

## Installation

### 1. Set environment variables

```bash
# In ~/.openclaw/.env
FASTMAIL_JMAP_TOKEN=your-token-here
FASTMAIL_ACCOUNT_ID=uXXXXXXXX
FASTMAIL_INBOX_ID=X-X
NOTIFY_CHANNEL=telegram
```

### 2. Install the systemd service

```bash
cp fastmail-sse.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now fastmail-sse
```

### 3. Check it's running

```bash
systemctl --user status fastmail-sse
journalctl --user -u fastmail-sse -f
```

You should see:
```
[fastmail-sse] config: agent=mail-agent, channel=telegram, account=uXXX...
[fastmail-sse] connecting (previous state: first run)
[fastmail-sse] initial state: J1234
```

Send yourself a test email and watch the logs.

## Finding Your IDs

### Fastmail Account ID

```bash
curl -s -H "Authorization: Bearer $FASTMAIL_JMAP_TOKEN" \
  https://api.fastmail.com/.well-known/jmap | python3 -m json.tool | grep accountId
```

### Inbox Mailbox ID

```bash
curl -s -X POST https://api.fastmail.com/jmap/api/ \
  -H "Authorization: Bearer $FASTMAIL_JMAP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
    "methodCalls": [["Mailbox/get", {"accountId": "YOUR_ACCOUNT_ID", "properties": ["name", "role"]}, "0"]]
  }' | python3 -m json.tool | grep -B1 '"role": "inbox"'
```

Look for the `id` field next to `"role": "inbox"`.

## Notification Format

| Email Type | Format |
|---|---|
| General | 📧 Sender Name: Subject line |
| Calendar accepted | 👤 Name accepted 👍: Event Name |
| Calendar declined | 👤 Name declined 👎: Event Name |
| Calendar tentative | 👤 Name tentative 🤷: Event Name |
| Marketing/noreply | *(skipped)* |

## Troubleshooting

**Service won't start:** Check `journalctl --user -u fastmail-sse` for missing env vars.

**No notifications:** Verify the agent exists (`openclaw agents list`) and the channel is configured.

**"connection lost" in logs:** Fastmail SSE connections time out after ~5 minutes of inactivity. The daemon reconnects automatically. This is normal.

**State file:** Stored at `~/.openclaw/services/fastmail-sse-state.json`. Delete it to reset (next run will skip existing emails and start fresh).
