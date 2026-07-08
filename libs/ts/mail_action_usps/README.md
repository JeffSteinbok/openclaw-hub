# 📮 USPS Mail Action

A mail action for the 📬 [Carapace Mail Runtime](https://github.com/JeffSteinbok/carapace-mail-runtime) that processes USPS Informed Delivery digest emails. It parses the digest HTML, runs vision analysis on each scan image, applies user-defined classification rules, routes notifications, and writes long-term mail memory.

> **Package:** `@openclaw/mail-action-usps`

---

## Quick Start

### 1. Install

```sh
cd libs/ts/mail_action_usps
npm install
npm run build
```

### 2. Register with the mail runtime

This action registers itself as `process_usps_digest` on the 📬 [Carapace Mail Runtime](https://github.com/JeffSteinbok/carapace-mail-runtime) action registry. Add it as an action plugin in your mail runtime config:

```json
{
  "action_plugins": [
    "/path/to/openclaw-hub/libs/ts/mail_action_usps/dist/register.js"
  ]
}
```

### 3. Create a mail rule to trigger it

In your `fastmail-sse-config.json` (or equivalent mail source config), add a rule that matches USPS Informed Delivery emails and dispatches them to this action:

```json
{
  "mail_rules": [
    {
      "id": "usps-informed-delivery",
      "accounts": ["<your-account-id>"],
      "match": {
        "sender_domain": "usps.com",
        "subject_contains": ["Informed Delivery"]
      },
      "actions": [
        {
          "name": "process_usps_digest",
          "params": {
            "workspace_agent": "mail",
            "memory_agent": "main",
            "vision_agent": "vision",
            "agent": "main"
          }
        }
      ],
      "continue": false
    }
  ]
}
```

### 4. Configure classification rules (optional)

Create `~/.openclaw/agents/<workspace_agent>/workspace/usps-mail/rules.json` to customize how mailpieces are classified after vision analysis:

```json
{
  "version": "1.2",
  "rules": [
    { "sender_contains": "county assessor", "importance": "high" },
    { "addressee_contains": "former resident", "importance": "low" }
  ]
}
```

Rules are **first match wins**. See [`docs/custom-rules.md`](docs/custom-rules.md) for the full guide.

### 5. Configure notification routing (optional)

Create `~/.openclaw/agents/<workspace_agent>/workspace/usps-mail/config.json` to route notifications to different recipients:

```json
{
  "routing": {
    "jeff": { "channel": "discord", "target": "<channel-id>" },
    "default": { "channel": "discord", "target": "<channel-id>" }
  }
}
```

---

## What it does

When a USPS Informed Delivery email arrives and matches your mail rule, the action:

1. **Parses** the digest HTML and detects the delivery date
2. **Analyzes** each scan image via a vision agent (sender, addressee, description, mail class)
3. **Classifies** each mailpiece using your rules (importance: urgent → junk)
4. **Persists** structured history in `usps_analysis.json`
5. **Notifies** recipients based on routing config (higher-priority items only)
6. **Writes** monthly mail memory for long-term recall
7. **Hands off** a structured summary to a downstream agent for any follow-up

### Rule operators

| Operator | Meaning |
|----------|---------|
| `<field>_contains` | Substring must be present (case-insensitive) |
| `<field>_not_contains` | Substring must be absent |
| `<field>_equals` | Exact normalized match |
| `<field>_not_equals` | Exact normalized mismatch |

Fields: `addressee`, `sender`, `description`, `mail_class`, `address_method`

### Importance levels

`urgent` · `high` · `medium` · `low` · `junk` · `ad` · `unknown`

---

## Interactive use

The [`usps-mail` plugin](../../../plugins/usps-mail/README.md) wraps this package as OpenClaw tools (`usps_process_digest`, `usps_lookup`, `usps_rules`) for manual/interactive use. It does not implement a separate USPS system — it calls directly into this library.

---

## Architecture

For internals — module layout, agent boundaries, the two-phase rule system, vision/memory agent design, and the full processing pipeline — see [**ARCHITECTURE.md**](ARCHITECTURE.md).

---

## 🔗 Related

| | Component | Description |
|---|-----------|-------------|
| 📬 | [Carapace Mail Runtime](https://github.com/JeffSteinbok/carapace-mail-runtime) | Rule engine and action registry that dispatches to this action |
| ⚡ | [FastMail SSE](../../../services/fastmail-sse/README.md) | Email source that feeds digests into the mail runtime |
| 📧 | [`usps-mail` plugin](../../../plugins/usps-mail/README.md) | Interactive tool surface for manual USPS processing |
| 📖 | [Custom rules guide](docs/custom-rules.md) | Full guide to writing USPS classification rules |
