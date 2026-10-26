/**
 * fs-utils plugin — workspace-scoped file operations.
 *
 * Provides `fs_list`, `fs_copy`, and `fs_move` tools that operate strictly
 * within the calling agent's workspace directory. All paths are relative to
 * `ctx.workspaceDir` (from OpenClaw's trusted tool context, forwarded by the
 * carapace SDK per call) and are validated to prevent path traversal outside
 * the workspace boundary.
 *
 * No absolute paths are accepted from callers — all inputs are workspace-relative.
 * There is deliberately no fallback (config, env var, cwd): without a
 * per-agent workspace the tools refuse to run.
 */

import { definePlugin, type ToolCallContext } from "carapace-plugin-sdk";
import { Type } from "@sinclair/typebox";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Resolves a workspace-relative path against `base` and validates that the
 * result stays within the workspace. Throws if the resolved path would escape
 * (e.g. via `../../` traversal).
 */
function resolveAndValidate(base: string, target: string): string {
  const resolved = path.resolve(base, target);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(`Path "${target}" is outside the workspace boundary.`);
  }
  return resolved;
}

/**
 * Returns the calling agent's workspace directory from the tool call context.
 * Throws if it is missing (standalone CLI, older hosts) rather than guessing.
 */
function getWorkspaceDir(ctx: ToolCallContext): string {
  const dir = ctx.workspaceDir;
  if (!dir) throw new Error(`fs-utils: workspaceDir not available in tool context for agent "${ctx.agentId ?? "unknown"}".`);
  return path.resolve(dir);
}

/** Fails if `dst` exists, unless the caller explicitly opted into overwriting. */
async function guardOverwrite(dst: string, destination: string, overwrite: boolean): Promise<void> {
  if (overwrite) return;
  try {
    await fs.access(dst);
  } catch (e: any) {
    if (e.code === "ENOENT") return;
    throw e;
  }
  throw new Error(`Destination "${destination}" already exists. Set overwrite: true to replace it.`);
}

const transferParams = Type.Object({
  source: Type.String({ description: "Workspace-relative source path." }),
  destination: Type.String({ description: "Workspace-relative destination path." }),
  overwrite: Type.Optional(Type.Boolean({ description: "Overwrite destination if it exists (default: false)." })),
});

export const createEntry = definePlugin({
  id: "fs-utils",
  name: "File System Utilities",
  description: "Copy, move, and list files within the agent workspace.",

  configSchema: Type.Object({}),

  tools: (tool) => [
    // -----------------------------------------------------------------------
    // fs_list — directory listing
    // -----------------------------------------------------------------------
    tool({
      name: "fs_list",
      label: "List Files",
      description: "List files and directories at a path within the workspace.",
      parameters: Type.Object({
        path: Type.String({ description: "Workspace-relative path to list. Use '.' for root." }),
        recursive: Type.Optional(Type.Boolean({ description: "List recursively (default: false)." })),
      }),
      async execute({ path: relPath, recursive = false }, _config, ctx) {
        const workspaceDir = getWorkspaceDir(ctx);
        const target = resolveAndValidate(workspaceDir, relPath);

        // Recursive helper — returns workspace-relative paths; directories get trailing slash
        async function listDir(dir: string): Promise<string[]> {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          const results: string[] = [];
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const rel = path.relative(workspaceDir, fullPath);
            results.push(entry.isDirectory() ? rel + "/" : rel);
            if (recursive && entry.isDirectory()) {
              results.push(...await listDir(fullPath));
            }
          }
          return results;
        }

        const entries = await listDir(target);
        // Return workspaceDir so callers can construct absolute paths if needed
        return { path: relPath, workspaceDir, entries };
      },
    }),

    // -----------------------------------------------------------------------
    // fs_copy — copy a file within the workspace
    // -----------------------------------------------------------------------
    tool({
      name: "fs_copy",
      label: "Copy File",
      description: "Copy a file from source to destination within the workspace.",
      parameters: transferParams,
      async execute({ source, destination, overwrite = false }, _config, ctx) {
        const workspaceDir = getWorkspaceDir(ctx);
        const src = resolveAndValidate(workspaceDir, source);
        const dst = resolveAndValidate(workspaceDir, destination);
        await guardOverwrite(dst, destination, overwrite);

        await fs.mkdir(path.dirname(dst), { recursive: true }); // create parent dirs if needed
        await fs.copyFile(src, dst);
        return { ok: true, source, destination };
      },
    }),

    // -----------------------------------------------------------------------
    // fs_move — move or rename a file within the workspace
    // -----------------------------------------------------------------------
    tool({
      name: "fs_move",
      label: "Move File",
      description: "Move or rename a file within the workspace.",
      parameters: transferParams,
      async execute({ source, destination, overwrite = false }, _config, ctx) {
        const workspaceDir = getWorkspaceDir(ctx);
        const src = resolveAndValidate(workspaceDir, source);
        const dst = resolveAndValidate(workspaceDir, destination);
        await guardOverwrite(dst, destination, overwrite);

        await fs.mkdir(path.dirname(dst), { recursive: true }); // create parent dirs if needed
        await fs.rename(src, dst); // atomic on same filesystem; cross-device will throw
        return { ok: true, source, destination };
      },
    }),
  ],
});
