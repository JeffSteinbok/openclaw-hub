# 📬 USPS Mail Analyzer

Analyze USPS Informed Delivery digest emails: parse mailpiece scans, vision-classify, apply rules, write memory, and send notifications.

> **Source:** [openclaw-hub](https://github.com/JeffSteinbok/openclaw-hub/tree/main/plugins/usps-mail)

## Tools

| Tool | Description |
|------|-------------|
| [`usps_process_digest`](#tool-usps_process_digest) | Process a USPS Informed Delivery digest folder and classify each mailpiece |
| [`usps_lookup`](#tool-usps_lookup) | Search saved USPS mail history by GUID, date, or text |
| [`usps_update_rule`](#tool-usps_update_rule) | Add, remove, or test USPS mail classification rules |
| [`usps_rules`](#tool-usps_rules) | List USPS classification rules or test a sample mailpiece |
| [`usps_stats`](#tool-usps_stats) | Show summary statistics for processed USPS mail |
| [`usps_status`](#tool-usps_status) | Show the current USPS mail workflow state |

## Configuration Schema

No configuration required — the plugin uses workspace and agent references passed as tool parameters.

## Tool Parameters

<a id="tool-usps_process_digest"></a>

### `usps_process_digest`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `folder` | string | Yes | Path to the digest folder containing mailpiece images |
| `analysis` | array | No | Pre-computed vision analysis results |
| `date` | string | No | Date of the digest (YYYY-MM-DD) |
| `dry_run` | boolean | No | If true, don't persist results |
| `vision_backend` | string | No | Vision backend to use |
| `message_id` | string | No | Source email message ID |
| `workspace_agent` | string | No | Workspace agent reference |
| `memory_agent` | string | No | Memory agent reference |
| `vision_agent` | string | No | Vision agent reference |

<a id="tool-usps_lookup"></a>

### `usps_lookup`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `guid` | string | No | Mailpiece GUID to look up |
| `date` | string | No | Date to search (YYYY-MM-DD) |
| `search` | string | No | Free-text search query |
| `workspace_agent` | string | No | Workspace agent reference |

<a id="tool-usps_update_rule"></a>

### `usps_update_rule`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | Action: add, remove, or test |
| `conditions` | string | No | Rule conditions (JSON) |
| `importance` | string | No | Importance level |
| `comment` | string | No | Rule comment |
| `index` | number | No | Rule index (for remove) |
| `comment_match` | string | No | Match rules by comment text |
| `mailpiece` | string | No | Mailpiece to test against |
| `workspace_agent` | string | No | Workspace agent reference |

<a id="tool-usps_rules"></a>

### `usps_rules`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `test_mailpiece` | string | No | Optional mailpiece to test against rules |
| `workspace_agent` | string | No | Workspace agent reference |

<a id="tool-usps_stats"></a>

### `usps_stats`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `workspace_agent` | string | No | Workspace agent reference |

<a id="tool-usps_status"></a>

### `usps_status`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `workspace_agent` | string | No | Workspace agent reference |

---

## CLI Usage

All tools are also available as a standalone CLI:

```bash
cd plugins/usps-mail
npm install && npm run build
node dist/bin/usps-mail.js --help
```

### Example commands

```bash
node dist/bin/usps-mail.js usps-process-digest /path/to/digest/folder
node dist/bin/usps-mail.js usps-lookup --guid abc123
node dist/bin/usps-mail.js usps-rules
node dist/bin/usps-mail.js usps-stats
node dist/bin/usps-mail.js usps-status

# JSON output
node dist/bin/usps-mail.js <command> [args...] --json
```
