/**
 * backup.ts — Config file rotation.
 *
 * Keeps up to BACKUP_VERSIONS numbered copies:
 *   openclaw.json.bak        ← most recent
 *   openclaw.json.bak.1
 *   openclaw.json.bak.2
 *   …
 *   openclaw.json.bak.N-1   ← oldest
 *
 * Also maintains openclaw.json.last-good, updated only when the
 * gateway passes its health check after a config change.
 */

import { copyFileSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILE, CONFIG_DIR, BACKUP_VERSIONS, log } from "./config.js";

/** Path to the primary (most-recent) backup */
export function bakPath(n?: number): string {
  const base = CONFIG_FILE + ".bak";
  return n == null || n === 0 ? base : `${base}.${n}`;
}

/** Path to the stash used when swapping in an older config */
export function stashPath(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return join(CONFIG_DIR, `openclaw.json.bad.${ts}`);
}

/** Path to the last-known-good snapshot */
export function lastGoodPath(): string {
  return CONFIG_FILE + ".last-good";
}

/**
 * Rotate existing backups by one slot and write a new .bak from the live config.
 * Returns the path of the new primary backup.
 */
export function rotateBackups(): string {
  // Shift older backups up: .bak.N-2 → .bak.N-1 … .bak → .bak.1
  for (let i = BACKUP_VERSIONS - 2; i >= 1; i--) {
    const src = bakPath(i - 1 === 0 ? undefined : i - 1);
    const dst = bakPath(i);
    if (existsSync(src)) {
      renameSync(src, dst);
      log(`rotated backup ${src} → ${dst}`);
    }
  }

  // Write fresh primary backup from live config
  const primary = bakPath();
  copyFileSync(CONFIG_FILE, primary);
  log(`backup written: ${primary}`);
  return primary;
}

/**
 * Stamp the last-known-good file from the current live config.
 * Call this after confirming gateway health post-change.
 */
export function stampLastGood(): void {
  const dst = lastGoodPath();
  copyFileSync(CONFIG_FILE, dst);
  log(`last-good updated: ${dst}`);
}

/**
 * Returns an ordered list of available backup paths, most-recent first.
 */
export function listBackups(): string[] {
  const candidates: string[] = [bakPath()];
  for (let i = 1; i < BACKUP_VERSIONS; i++) {
    candidates.push(bakPath(i));
  }
  return candidates.filter(existsSync);
}
