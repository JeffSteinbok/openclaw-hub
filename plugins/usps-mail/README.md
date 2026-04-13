# USPS Mail Analyzer — OpenClaw Plugin

Process USPS Informed Delivery digests into structured mail summaries. This plugin is the **interactive tool surface** for the USPS system: it exposes manual processing, lookup, rule management, stats, and status tools, while the core USPS implementation lives in `libs/python/mail_action_usps/`.

## How it fits with the mail runtime

The USPS system is split in two layers:

| Layer | Location | Role |
|------|----------|------|
| Core implementation | `libs/python/mail_action_usps/` | Parse digest HTML, run vision, apply rules, write memory, route notifications, update workflow state |
| Tool/plugin wrapper | `plugins/usps-mail/src/tools.py` | Expose that shared logic as callable OpenClaw tools and offline CLI commands |

Automatic FastMail processing does **not** go through this plugin. `services/fastmail-sse/usps_integration.py` calls the shared runtime directly when a matching mail rule fires.

Keep this plugin when you want USPS as an operator/debugging interface. The shared runtime remains the source of truth for the USPS workflow itself.

## Tools

| Tool | Description |
|------|-------------|
| `usps_process_digest` | Process a digest folder and classify each mailpiece |
| `usps_lookup` | Search saved USPS mail history |
| `usps_update_rule` | Add, remove, or test classification rules |
| `usps_rules` | List rules or test a sample mailpiece |
| `usps_stats` | Show summary statistics for processed mail |
| `usps_status` | Show the current workflow state |

## Vision Backends

- **`auto`**: Use the configured vision agent to analyze scan images
- **`provided`**: Use a precomputed analysis array supplied by the caller
- **`skip`**: Parse the digest without doing image analysis

For the full two-phase USPS model, including the `rules.json` and `config.json` schemas, see `libs/python/mail_action_usps/README.md`.

## Data Locations

Personal data lives outside the plugin folder:

| What | Where |
|------|-------|
| Rules | `~/.openclaw/agents/mail/workspace/usps-mail/rules.json` |
| Routing config | `~/.openclaw/agents/mail/workspace/usps-mail/config.json` |
| Analysis history | `~/.openclaw/agents/<workspace_agent>/workspace/memory/usps_analysis.json` |
| Workflow state | `~/.openclaw/agents/<workspace_agent>/workspace/memory/usps_state.json` |
| Mail memory | `~/.openclaw/agents/main/workspace/memory/mail/mail_memory_YYYY-MM.md` |

For the current FastMail automation path, `workspace_agent` is typically `mail` and `memory_agent` is typically `main`.

## Notes

- `usps_process_digest` expects a folder containing `body.html` plus the mailpiece images for that digest.
- Rules can be updated conversationally through `usps_update_rule`, which makes it easy to tune what counts as urgent, junk, or routine mail.
- Notification routing is based on the addressee and only fires for higher-importance mail.
- The plugin's Python entrypoint is `src/tools.py`; the USPS workflow code it calls lives in `libs/python/mail_action_usps/`.

## Offline CLI Testing

```bash
cd plugins/usps-mail/src
python3 tools.py --cli stats --workspace-agent mail
python3 tools.py --cli lookup --workspace-agent mail --search "amazon"
python3 tools.py --cli process --workspace-agent mail --memory-agent main \
  --folder /path/to/digest --vision skip --dry-run
```

## Build

```bash
cd plugins/usps-mail
npm install
npm run build
```
