/**
 * config.ts — Config loading and types for webhook-proxy.
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Constants ────────────────────────────────────────────────

export const CONFIG_FILE =
  process.env["WEBHOOK_PROXY_CONFIG"] ??
  join(homedir(), ".openclaw/services/webhook-proxy-config.json");

export const PORT = parseInt(process.env["WEBHOOK_PROXY_PORT"] ?? "18792", 10);

// ── Types ────────────────────────────────────────────────────

/** HMAC-SHA256 auth: validates X-Hub-Signature-256 (or custom header). */
export interface HmacAuth {
  type: "hmac-sha256";
  /** Request header carrying the signature, e.g. "X-Hub-Signature-256" */
  header: string;
  /** Env var name containing the shared secret */
  secret_env: string;
}

/** Bearer token auth: validates Authorization: Bearer <token> */
export interface BearerAuth {
  type: "bearer";
  /** Env var name containing the expected bearer token */
  secret_env: string;
}

/** No auth — pass through. Only use for internal/LAN-only routes. */
export interface NoneAuth {
  type: "none";
}

export type RouteAuth = HmacAuth | BearerAuth | NoneAuth;

export interface Route {
  /** Incoming request path to match (exact) */
  path: string;
  /** Auth validation to perform before forwarding */
  auth: RouteAuth;
  /**
   * Path to forward to on the OpenClaw instance.
   * Defaults to the same as `path` if omitted.
   */
  forward_path?: string;
}

export interface Config {
  /** Base URL of the OpenClaw instance, e.g. "http://127.0.0.1:18789" */
  openclaw_url: string;
  /** Env var name containing the OpenClaw hooks bearer token */
  openclaw_bearer_env: string;
  /** Route rules, evaluated in order — first match wins */
  routes: Route[];
}

// ── Helpers ──────────────────────────────────────────────────

export function log(msg: string): void {
  const ts = new Date().toISOString();
  console.log(`[webhook-proxy] ${ts} ${msg}`);
}

export function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(
      `ERROR: Required environment variable ${name} is not set. ` +
        `Add it to your .env file or systemd EnvironmentFile.`,
    );
    process.exit(1);
  }
  return val;
}

export function loadConfig(): Config {
  if (!existsSync(CONFIG_FILE)) {
    console.error(`ERROR: Config file not found at ${CONFIG_FILE}`);
    process.exit(1);
  }
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as Config;
  } catch (e) {
    console.error(`ERROR: Invalid JSON in ${CONFIG_FILE}: ${e}`);
    process.exit(1);
  }
}
