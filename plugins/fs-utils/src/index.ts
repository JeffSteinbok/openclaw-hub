/**
 * fs-utils plugin — workspace-scoped file operations.
 *
 * Provides `fs_list`, `fs_copy`, and `fs_move` tools that operate strictly
 * within the calling agent's workspace directory. All paths are relative to
 * `ctx.workspaceDir` (injected by the OpenClaw plugin SDK at call time) and
 * are validated to prevent path traversal outside the workspace boundary.
 *
 * No absolute paths are accepted from callers — all inputs are workspace-relative.
 */

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
 * Extracts the workspace directory from the tool execution context.
 * `ctx.workspaceDir` is set by the OpenClaw plugin SDK to the agent's
 * workspace root (e.g. `~/.openclaw/agents/<id>/workspace`).
 * Throws if workspaceDir is not available, which should never happen in
 * a properly configured agent — but surfaces a clear error if it does.
 */
function getWorkspaceDir(ctx: any): string {
  const dir = ctx?.workspaceDir;
  if (!dir) throw new Error(`fs-utils: workspaceDir not available in tool context for agent "${ctx?.agentId ?? "unknown"}".`);
  return dir;
}

export function register(api: any) {
  // -------------------------------------------------------------------------
  // fs_list — directory listing
  // -------------------------------------------------------------------------
  api.registerTool((ctx: any) => {
    return {
      name: "fs_list",
      label: "List Files",
      description: "List files and directories at a path within the workspace.",
      parameters: Type.Object({
        path: Type.String({ description: "Workspace-relative path to list. Use '.' for root." }),
        recursive: Type.Optional(Type.Boolean({ description: "List recursively (default: false)." })),
      }),
      async execute(...execArgs: any[]) {
        // SDK may pass params as first or second argument depending on call convention
        const params = typeof execArgs[0] === 'object' && execArgs[0] !== null && 'path' in execArgs[0] ? execArgs[0] : execArgs[1];
        const relPath: string = params?.path;
        const recursive: boolean = params?.recursive ?? false;
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
    };
  });

  // -------------------------------------------------------------------------
  // fs_copy — copy a file within the workspace
  // -------------------------------------------------------------------------
  api.registerTool((ctx: any) => {
    return {
      name: "fs_copy",
      label: "Copy File",
      description: "Copy a file from source to destination within the workspace.",
      parameters: Type.Object({
        source: Type.String({ description: "Workspace-relative source path." }),
        destination: Type.String({ description: "Workspace-relative destination path." }),
        overwrite: Type.Optional(Type.Boolean({ description: "Overwrite destination if it exists (default: false)." })),
      }),
      async execute(...execArgs: any[]) {
        const params = typeof execArgs[0] === 'object' && execArgs[0] !== null && 'source' in execArgs[0] ? execArgs[0] : execArgs[1];
        const source: string = params?.source;
        const destination: string = params?.destination;
        const overwrite: boolean = params?.overwrite ?? false;
        const workspaceDir = getWorkspaceDir(ctx);
        const src = resolveAndValidate(workspaceDir, source);
        const dst = resolveAndValidate(workspaceDir, destination);

        // Guard against accidental overwrites unless caller explicitly opts in
        if (!overwrite) {
          try {
            await fs.access(dst);
            throw new Error(`Destination "${destination}" already exists. Set overwrite: true to replace it.`);
          } catch (e: any) {
            if (e.code !== "ENOENT") throw e;
          }
        }

        await fs.mkdir(path.dirname(dst), { recursive: true }); // create parent dirs if needed
        await fs.copyFile(src, dst);
        return { ok: true, source, destination };
      },
    };
  });

  // -------------------------------------------------------------------------
  // fs_move — move or rename a file within the workspace
  // -------------------------------------------------------------------------
  api.registerTool((ctx: any) => {
    return {
      name: "fs_move",
      label: "Move File",
      description: "Move or rename a file within the workspace.",
      parameters: Type.Object({
        source: Type.String({ description: "Workspace-relative source path." }),
        destination: Type.String({ description: "Workspace-relative destination path." }),
        overwrite: Type.Optional(Type.Boolean({ description: "Overwrite destination if it exists (default: false)." })),
      }),
      async execute(...execArgs: any[]) {
        const params = typeof execArgs[0] === 'object' && execArgs[0] !== null && 'source' in execArgs[0] ? execArgs[0] : execArgs[1];
        const source: string = params?.source;
        const destination: string = params?.destination;
        const overwrite: boolean = params?.overwrite ?? false;
        const workspaceDir = getWorkspaceDir(ctx);
        const src = resolveAndValidate(workspaceDir, source);
        const dst = resolveAndValidate(workspaceDir, destination);

        // Guard against accidental overwrites unless caller explicitly opts in
        if (!overwrite) {
          try {
            await fs.access(dst);
            throw new Error(`Destination "${destination}" already exists. Set overwrite: true to replace it.`);
          } catch (e: any) {
            if (e.code !== "ENOENT") throw e;
          }
        }

        await fs.mkdir(path.dirname(dst), { recursive: true }); // create parent dirs if needed
        await fs.rename(src, dst); // atomic on same filesystem; cross-device will throw
        return { ok: true, source, destination };
      },
    };
  });
}
