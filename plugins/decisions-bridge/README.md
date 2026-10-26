# Decisions Bridge

Lets scripts use OpenClaw's [decision model](https://docs.openclaw.ai/concepts/decision-models) role. Plugins can call `api.runtime.decisions.evaluate`; a cron script or shell tool can't. This plugin exposes it as a Gateway method, so anything that can run `openclaw gateway call` can ask an agent's decision model (for example TypeSafe Jev or a local Kev) a typed question.

## Calling it

```sh
openclaw gateway call decisions-bridge.evaluate --json --params '{
  "agentId": "root",
  "purpose": "octo.session-labels",
  "rubricVersion": "1",
  "request": {
    "state": { "firstMessage": "Fix the failing build on main" },
    "questions": {
      "label": {
        "type": "choice",
        "instructions": "What kind of session is this?",
        "criteria": { "coding": "Writing or fixing code", "chat": "Conversation or questions" }
      }
    }
  }
}'
```

The response is `{ "status": "ok", "answers": { … }, "model": "…" }`, with answers shaped as in the OpenClaw docs (`probabilityTrue` for boolean, `choice` and `probabilities` for choice, a score for score). If the agent has no decision model, the provider fails or the call times out, it is `{ "status": "unavailable", "reason": "…" }`. The method never throws for those, so a caller can always fall back to its old behavior.

| Param | |
|---|---|
| `agentId` | Required. The agent whose `decisionModel` answers. Must be listed in the plugin's `agents` config. |
| `purpose` | Required, namespaced: `<namespace>.<gate>`. Recorded in result provenance. |
| `rubricVersion` | Defaults to `"1"`. Change it when a rubric's meaning changes. |
| `request` | `{ state, questions }`, passed straight to `decisions.evaluate`. Question types: `boolean`, `choice`, `score`. |
| `timeoutMs` | Defaults to 15000, capped at 30000. Pass a larger `--timeout` to `gateway call`. |

## Configuration

```json
"decisions-bridge": { "enabled": true, "config": { "agents": ["root", "main"] } }
```

Only the listed agents can be named, so a caller can't spend another agent's decision model. The method needs `operator.write`: each call can cost money and sends its `state` to the configured provider.

## Used by

[Octo](https://octo.steinbok.net/decision-models) calls it from `scripts/decide.py` for gates that run in scripts (cost-report labels, calendar event classification and others), each rolled out log-only first.

## Plugin Structure

```
openclaw.plugin.json
package.json
tsconfig.json
vitest.config.ts
src/
  bridge.ts       # param validation, response shape
  bridge.test.ts
  index.ts        # registers decisions-bridge.evaluate
```
