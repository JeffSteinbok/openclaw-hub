/**
 * Security — path validation and traversal prevention.
 *
 * All file access must go through resolveSafePath to ensure confinement
 * to the configured vault root directory.
 */

import { resolve, relative, sep } from "node:path";
import { realpathSync, lstatSync } from "node:fs";

/**
 * Resolve a user-supplied path relative to the vault root, ensuring it stays
 * within the vault boundary. Rejects path traversal and symlink escapes.
 *
 * @param vaultRoot Canonical (realpath-resolved) vault root directory
 * @param requestedPath Relative note path (e.g. "Projects/Home Assistant/Battery.md")
 * @returns Canonical absolute path guaranteed to be inside vaultRoot
 * @throws Error if path escapes vault or targets a symlink outside vault
 */
export function resolveSafePath(vaultRoot: string, requestedPath: string): string {
  if (!requestedPath) {
    throw new Error("Path must not be empty");
  }

  // Reject obviously malicious patterns before doing any filesystem work
  const normalized = requestedPath.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.includes("\0")) {
    throw new Error("Invalid path: absolute paths and null bytes are not allowed");
  }

  // Join and canonicalize
  const joined = resolve(vaultRoot, requestedPath);

  let canonical: string;
  try {
    canonical = realpathSync(joined);
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // File doesn't exist yet — check the joined path directly
      const rel = relative(vaultRoot, joined);
      if (rel.startsWith("..") || rel.startsWith(sep + sep)) {
        throw new Error("Path escapes vault root");
      }
      return joined;
    }
    throw e;
  }

  // Ensure canonical path is within the canonical vault root
  if (!canonical.startsWith(vaultRoot + sep) && canonical !== vaultRoot) {
    throw new Error("Path escapes vault root");
  }

  return canonical;
}

/**
 * Canonicalize the vault root directory, ensuring it exists and is a directory.
 */
export function canonicalizeVaultRoot(vaultRoot: string): string {
  try {
    const canonical = realpathSync(vaultRoot);
    const stat = lstatSync(canonical);
    if (!stat.isDirectory()) {
      throw new Error(`Vault root is not a directory: ${vaultRoot}`);
    }
    return canonical;
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(`Vault root does not exist: ${vaultRoot}`);
    }
    throw e;
  }
}

/**
 * Validate that the index location is not inside the vault root.
 */
export function validateIndexLocation(vaultRoot: string, indexLocation: string): void {
  const canonicalIndex = resolve(indexLocation);
  if (canonicalIndex.startsWith(vaultRoot + sep) || canonicalIndex === vaultRoot) {
    throw new Error(
      `Index location must not be inside vault root. ` +
      `vaultRoot=${vaultRoot}, indexLocation=${indexLocation}`
    );
  }
}
