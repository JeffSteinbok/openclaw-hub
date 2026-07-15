/**
 * config.ts — Environment / constants for config-watchdog.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_FILE = process.env["OPENCLAW_CONFIG_FILE"]
  ?? join(homedir(), ".openclaw", "openclaw.json");

export const CONFIG_DIR = process.env["OPENCLAW_CONFIG_DIR"]
  ?? join(homedir(), ".openclaw");

/** How many numbered backup versions to keep (e.g. .bak, .bak.1 … .bak.N-1) */
export const BACKUP_VERSIONS = Number(process.env["WATCHDOG_BACKUP_VERSIONS"] ?? "10");

/** Milliseconds to debounce rapid file-change events */
export const DEBOUNCE_MS = Number(process.env["WATCHDOG_DEBOUNCE_MS"] ?? "500");

/** How long (ms) to wait for the gateway to come up after a restart before declaring failure */
export const HEALTH_TIMEOUT_MS = Number(process.env["WATCHDOG_HEALTH_TIMEOUT_MS"] ?? "30000");

/** How long (ms) between health-check retries while waiting */
export const HEALTH_POLL_INTERVAL_MS = Number(process.env["WATCHDOG_HEALTH_POLL_INTERVAL_MS"] ?? "2000");

/** Gateway base URL — must be the local HTTP endpoint */
export const GATEWAY_URL = process.env["OPENCLAW_GATEWAY_URL"]
  ?? `http://127.0.0.1:${process.env["OPENCLAW_GATEWAY_PORT"] ?? "18789"}`;

/** Bearer token for gateway health endpoint */
export const GATEWAY_TOKEN = process.env["OPENCLAW_GATEWAY_AUTH_TOKEN"] ?? "";

/** systemd unit name for the gateway */
export const GATEWAY_UNIT = process.env["OPENCLAW_SYSTEMD_UNIT"] ?? "openclaw-gateway.service";

/** GitHub repo for filing incident issues: owner/repo */
export const GITHUB_REPO_OWNER = process.env["WATCHDOG_GITHUB_OWNER"] ?? "JeffSteinbok";
export const GITHUB_REPO_NAME  = process.env["WATCHDOG_GITHUB_REPO"]  ?? "octo";

/** GitHub API token */
export const GITHUB_TOKEN = process.env["GITHUB_TOKEN"] ?? "";

export function log(msg: string): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}] config-watchdog: ${msg}`);
}
