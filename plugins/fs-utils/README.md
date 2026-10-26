# File System Utilities

Copy, move, and list files inside the calling agent's workspace.

| Tool | Purpose |
|------|---------|
| `fs_list` | List a workspace directory, optionally recursively |
| `fs_copy` | Copy a file within the workspace |
| `fs_move` | Move or rename a file within the workspace |

All paths are workspace-relative. The workspace comes from OpenClaw's trusted
tool context for each call (`ctx.workspaceDir`, via the carapace SDK), so each
agent only sees its own workspace. Paths that resolve outside it are refused.
There is no config, env var, or cwd fallback: when the workspace is unknown
(for example, the standalone CLI), the tools fail instead of guessing.

## Build

```bash
npm run build
npm test
```
