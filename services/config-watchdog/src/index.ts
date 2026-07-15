/**
 * index.ts — Entry point for config-watchdog.
 *
 * Watches ~/.openclaw/openclaw.json for changes. On each change:
 *   1. Rotate backups (keep BACKUP_VERSIONS copies)
 *   2. Health-check the gateway
 *   3. If unhealthy, run the recovery sequence (see recovery.ts)
 *   4. If healthy, stamp last-known-good
 *
 * Environment variables (all optional with sensible defaults):
 *   OPENCLAW_CONFIG_FILE       — path to config (default: ~/.openclaw/openclaw.json)
 *   WATCHDOG_BACKUP_VERSIONS   — number of backup slots (default: 10)
 *   WATCHDOG_DEBOUNCE_MS       — fs.watch debounce delay (default: 500)
 *   WATCHDOG_HEALTH_TIMEOUT_MS — max ms to wait for gateway after restart (default: 30000)
 *   WATCHDOG_HEALTH_POLL_INTERVAL_MS — ms between health polls (default: 2000)
 *   OPENCLAW_GATEWAY_URL       — gateway base URL (default: http://127.0.0.1:18789)
 *   OPENCLAW_GATEWAY_AUTH_TOKEN — bearer token for health endpoint
 *   OPENCLAW_SYSTEMD_UNIT      — unit name to restart (default: openclaw-gateway.service)
 *   GITHUB_TOKEN               — for filing incident issues
 *   WATCHDOG_GITHUB_OWNER      — GitHub repo owner (default: JeffSteinbok)
 *   WATCHDOG_GITHUB_REPO       — GitHub repo name (default: octo)
 */

import { watch } from "node:fs";
import { rotateBackups, stampLastGood } from "./backup.js";
import { checkHealth, waitForHealth } from "./gateway.js";
import { runRecovery } from "./recovery.js";
import { CONFIG_FILE, DEBOUNCE_MS, log } from "./config.js";

// ── State ──────────────────────────────────────────────────────────────────

/** Prevent overlapping recovery runs if the file changes while we're working */
let recovering = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// ── Config change handler ──────────────────────────────────────────────────

async function onConfigChanged(): Promise<void> {
  if (recovering) {
    log("config changed while recovery in progress — will re-check after");
    return;
  }

  log("config change detected");

  // Step 1: rotate backups
  try {
    rotateBackups();
  } catch (e) {
    log(`ERROR: backup rotation failed: ${e}`);
    // Don't abort — still need to health-check
  }

  // Step 2: health check (give the gateway a moment to reload)
  await sleep(1500);
  const healthy = await checkHealth();

  if (healthy) {
    log("gateway healthy after config change — stamping last-good");
    try {
      stampLastGood();
    } catch (e) {
      log(`ERROR: could not stamp last-good: ${e}`);
    }
    return;
  }

  // Step 3: gateway is down — run full recovery
  log("gateway unhealthy after config change — starting recovery");
  recovering = true;
  try {
    await runRecovery();
  } finally {
    recovering = false;
  }
}

// ── Startup health check ───────────────────────────────────────────────────

async function startupCheck(): Promise<void> {
  log("startup health check...");
  const healthy = await checkHealth();
  if (healthy) {
    log("gateway healthy at startup — stamping last-good");
    try {
      stampLastGood();
    } catch (e) {
      log(`WARN: could not stamp last-good at startup: ${e}`);
    }
  } else {
    log("WARN: gateway not healthy at startup — will watch for config changes");
  }
}

// ── Watcher setup ──────────────────────────────────────────────────────────

function startWatcher(): void {
  log(`watching: ${CONFIG_FILE}`);

  const watcher = watch(CONFIG_FILE, (eventType) => {
    if (eventType !== "change" && eventType !== "rename") return;

    // Debounce: editors and atomic-write patterns fire multiple events
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      onConfigChanged().catch((e) => log(`ERROR in onConfigChanged: ${e}`));
    }, DEBOUNCE_MS);
  });

  watcher.on("error", (e) => {
    log(`watcher error: ${e} — restarting watcher in 5s`);
    watcher.close();
    setTimeout(startWatcher, 5_000);
  });

  // Some editors do atomic saves (write tmp → rename) which closes the watch
  // target. Re-arm on close so we don't silently stop watching.
  watcher.on("close", () => {
    log("watcher closed unexpectedly — restarting in 2s");
    setTimeout(startWatcher, 2_000);
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log("config-watchdog starting");
  log(`config file : ${CONFIG_FILE}`);

  await startupCheck();
  startWatcher();

  // Graceful shutdown
  const shutdown = (signal: string) => {
    log(`${signal} — shutting down`);
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));

  log("watching for config changes");
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
