/**
 * recovery.ts — Orchestrates the full recovery sequence when the gateway
 * goes down after a config change.
 *
 * Recovery ladder:
 *   1. Swap in last-known-good config → restart → health check
 *   2. Try each numbered backup in order → restart → health check
 *   3. Run `openclaw doctor fix` → restart → health check
 *   4. File a GitHub incident issue and give up
 */

import { copyFileSync, existsSync, renameSync } from "node:fs";
import { stashPath, lastGoodPath, listBackups, stampLastGood } from "./backup.js";
import { checkHealth, waitForHealth, restartGateway, runDoctorFix, runDoctor } from "./gateway.js";
import { fileIncidentIssue } from "./github.js";
import { CONFIG_FILE, log } from "./config.js";

/**
 * Swap the current (bad) config out and put `candidatePath` in its place.
 * The bad config is stashed with a timestamped filename so nothing is lost.
 */
function swapConfig(candidatePath: string): void {
  const stash = stashPath();
  log(`stashing bad config → ${stash}`);
  renameSync(CONFIG_FILE, stash);
  log(`swapping in candidate: ${candidatePath}`);
  copyFileSync(candidatePath, CONFIG_FILE);
}

/**
 * Try a single candidate config: swap it in, restart gateway, wait for health.
 * Returns true if the gateway came up healthy.
 */
async function tryCandidate(label: string, candidatePath: string): Promise<boolean> {
  log(`--- recovery attempt: ${label} ---`);
  swapConfig(candidatePath);
  restartGateway();
  const ok = await waitForHealth();
  if (ok) {
    log(`recovery succeeded with ${label}`);
    stampLastGood();
  } else {
    log(`recovery failed with ${label}`);
  }
  return ok;
}

/**
 * Full recovery sequence. Call this when a config change caused a health failure.
 */
export async function runRecovery(): Promise<void> {
  log("=== STARTING RECOVERY SEQUENCE ===");

  // ── Step 1: try last-known-good ───────────────────────────────────────────
  const lastGood = lastGoodPath();
  if (existsSync(lastGood)) {
    if (await tryCandidate("last-known-good", lastGood)) return;
  } else {
    log("no last-known-good snapshot available, skipping");
  }

  // ── Step 2: try numbered backups in order (most recent first) ─────────────
  const backups = listBackups();
  log(`found ${backups.length} numbered backup(s) to try`);
  for (const bak of backups) {
    if (await tryCandidate(`backup ${bak}`, bak)) return;
  }

  // ── Step 3: doctor fix → restart ─────────────────────────────────────────
  log("=== all config candidates exhausted — trying doctor fix ===");
  const fixOutput = runDoctorFix();
  log(`doctor fix output:\n${fixOutput}`);
  restartGateway();
  const fixOk = await waitForHealth();
  if (fixOk) {
    log("recovery succeeded after doctor fix");
    stampLastGood();
    return;
  }

  // ── Step 4: file incident issue ───────────────────────────────────────────
  log("=== RECOVERY EXHAUSTED — filing incident issue ===");
  const doctorOut = runDoctor();
  const issueUrl = await fileIncidentIssue(doctorOut);
  if (issueUrl) {
    log(`incident issue: ${issueUrl}`);
  } else {
    log("ERROR: could not file incident issue — check GITHUB_TOKEN");
  }

  log("=== GIVING UP — manual intervention required ===");
}
