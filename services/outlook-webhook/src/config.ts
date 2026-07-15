/**
 * Constants, environment helpers, and config loading for outlook-webhook.
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Constants ────────────────────────────────────────────────

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
export const TOKEN_URL =
  "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";

export const STATE_FILE = join(
  homedir(),
  ".openclaw/state/outlook-webhook.json",
);

export const CONFIG_FILE = join(
  homedir(),
  ".openclaw/services/outlook-webhook-config.json",
);

/** Public webhook URL (Tailscale Funnel) */
export const WEBHOOK_URL =
  process.env["OUTLOOK_WEBHOOK_URL"] ??
  "https://jeff-x1yogag3.tail498490.ts.net/outlook/webhook";

/** Local port the HTTP server listens on */
export const WEBHOOK_PORT = parseInt(
  process.env["OUTLOOK_WEBHOOK_PORT"] ?? "18790",
  10,
);

/** Graph subscription expiry: 72 hours (max allowed for mail) */
export const SUBSCRIPTION_TTL_MS = 72 * 60 * 60 * 1000;

/** Renew when less than 12 hours remain */
export const RENEWAL_THRESHOLD_MS = 12 * 60 * 60 * 1000;

/** How often to check if renewal is needed (every 30 min) */
export const RENEWAL_CHECK_INTERVAL_MS = 30 * 60 * 1000;

// ── Types ────────────────────────────────────────────────────

export interface RuntimeConfig {
  mail_rules?: MailRule[];
  action_plugins?: string[];
  [key: string]: unknown;
}

export interface MailRule {
  id: string;
  accounts?: string[];
  match?: Record<string, unknown>;
  actions: Array<string | Record<string, unknown>>;
  continue?: boolean;
  enabled?: boolean;
  [key: string]: unknown;
}

// ── Helpers ──────────────────────────────────────────────────

export function log(msg: string): void {
  console.log(`[outlook-webhook] ${msg}`);
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

export function loadRuntimeConfig(): RuntimeConfig {
  if (!existsSync(CONFIG_FILE)) {
    log(
      `No config file found at ${CONFIG_FILE} — starting with empty rules.`,
    );
    return {};
  }

  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as RuntimeConfig;
  } catch (e) {
    log(`WARNING: Invalid JSON in ${CONFIG_FILE}: ${e} — using empty rules.`);
    return {};
  }
}

export function buildPipelineRules(config: RuntimeConfig): MailRule[] {
  return [...(config.mail_rules ?? [])];
}
