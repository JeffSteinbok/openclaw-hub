/**
 * gateway.ts — Gateway health checks and restart helpers.
 */

import { execSync, spawnSync } from "node:child_process";
import {
  GATEWAY_URL,
  GATEWAY_TOKEN,
  GATEWAY_UNIT,
  HEALTH_TIMEOUT_MS,
  HEALTH_POLL_INTERVAL_MS,
  log,
} from "./config.js";

/** Single health check against the gateway HTTP endpoint. Returns true if healthy. */
export async function checkHealth(): Promise<boolean> {
  try {
    const url = `${GATEWAY_URL}/health`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (GATEWAY_TOKEN) headers["Authorization"] = `Bearer ${GATEWAY_TOKEN}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(5000), headers });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Poll health until it passes or timeout expires.
 * Returns true if gateway came up within the window.
 */
export async function waitForHealth(): Promise<boolean> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await checkHealth()) return true;
    await sleep(HEALTH_POLL_INTERVAL_MS);
  }
  return false;
}

/** Restart the gateway systemd unit. */
export function restartGateway(): void {
  log(`restarting ${GATEWAY_UNIT} via systemctl --user`);
  spawnSync("systemctl", ["--user", "restart", GATEWAY_UNIT], { stdio: "inherit" });
}

/**
 * Run `openclaw doctor fix` and return its combined stdout+stderr output.
 */
export function runDoctorFix(): string {
  log("running: openclaw doctor fix");
  try {
    const result = spawnSync("openclaw", ["doctor", "fix"], {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env },
    });
    return (result.stdout ?? "") + (result.stderr ?? "");
  } catch (e) {
    return `doctor fix threw: ${e}`;
  }
}

/**
 * Run `openclaw doctor` (read-only) and return its combined output.
 */
export function runDoctor(): string {
  log("running: openclaw doctor");
  try {
    const result = spawnSync("openclaw", ["doctor"], {
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env },
    });
    return (result.stdout ?? "") + (result.stderr ?? "");
  } catch (e) {
    return `doctor threw: ${e}`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
