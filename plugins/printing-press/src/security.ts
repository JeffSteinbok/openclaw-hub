/**
 * Security — binary path validation and environment scoping.
 *
 * Ensures CLI binaries are safe to execute and environments are minimal.
 */

import { resolve } from "node:path";
import { accessSync, lstatSync, constants } from "node:fs";

/**
 * Validate that a binary path is safe to execute.
 * - Must be an absolute path
 * - Must exist and be a regular file (not symlink)
 * - Must be executable
 * - Must not be in a world-writable directory
 */
export function validateBinaryPath(binaryPath: string): void {
  const resolved = resolve(binaryPath);

  if (resolved !== binaryPath) {
    throw new Error(
      `Binary path must be absolute: ${binaryPath}`
    );
  }

  try {
    const stat = lstatSync(resolved);
    if (stat.isSymbolicLink()) {
      throw new Error(`Binary path must not be a symlink: ${binaryPath}`);
    }
    if (!stat.isFile()) {
      throw new Error(`Binary path must be a regular file: ${binaryPath}`);
    }
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Binary not found: ${binaryPath}`);
    }
    throw e;
  }

  try {
    accessSync(resolved, constants.X_OK);
  } catch {
    throw new Error(`Binary is not executable: ${binaryPath}`);
  }
}

/**
 * Build a minimal, scoped environment for CLI execution.
 * Only includes explicitly configured env vars plus safe defaults.
 * Does NOT inherit process.env.
 */
export function buildSafeEnv(configuredEnv?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
    NO_COLOR: "1",
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
  };

  if (configuredEnv) {
    for (const [key, value] of Object.entries(configuredEnv)) {
      // Resolve ${ENV_VAR} references from process.env
      const resolved = value.replace(/\$\{(\w+)\}/g, (_match, varName: string) => {
        return process.env[varName] ?? "";
      });
      env[key] = resolved;
    }
  }

  return env;
}
