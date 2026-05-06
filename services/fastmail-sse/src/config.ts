/**
 * Constants, environment helpers, and config loading.
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Constants ────────────────────────────────────────────────

export const JMAP_API = "https://api.fastmail.com/jmap/api/";
export const EVENT_URL =
  "https://api.fastmail.com/jmap/event/?types=Email,EmailDelivery&closeafter=no&ping=30";
export const STATE_FILE = join(
  homedir(),
  ".openclaw/services/fastmail-sse-state.json",
);
export const CONFIG_FILE = join(
  homedir(),
  ".openclaw/services/fastmail-sse-config.json",
);
export const RECONNECT_DELAY = 10;
export const EMAIL_PROPS = [
  "id",
  "from",
  "subject",
  "receivedAt",
  "textBody",
  "htmlBody",
  "bodyValues",
  "blobId",
  "header:Authentication-Results:asText",
];

// ── Types ────────────────────────────────────────────────────

export interface AccountConfig {
  label: string;
  [key: string]: unknown;
}

export interface RuntimeConfig {
  accounts: Record<string, AccountConfig>;
  mail_rules?: MailRule[];
  /**
   * Paths to external ESM action plugin modules to load at startup.
   * Each module must export a `register(registry: ActionRegistry)` function.
   * Paths are resolved as-is (use absolute paths or paths relative to the process cwd).
   *
   * @example
   * "action_plugins": ["/home/user/git/octo/services/mail-actions/dist/index.js"]
   */
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
  console.log(`[fastmail-sse] ${msg}`);
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

export function getToken(): string {
  const t = process.env["FASTMAIL_JMAP_TOKEN"];
  if (t) return t;
  const p = join(homedir(), ".fastmail_token");
  if (existsSync(p)) {
    return readFileSync(p, "utf-8").trim();
  }
  console.error(
    "FASTMAIL_JMAP_TOKEN not found (checked env + ~/.fastmail_token)",
  );
  process.exit(1);
}

export function loadRuntimeConfig(): RuntimeConfig {
  if (!existsSync(CONFIG_FILE)) {
    console.error(
      `ERROR: Configuration file not found: ${CONFIG_FILE}\n` +
        `Create this file with mail account config. See README for format.`,
    );
    process.exit(1);
  }

  let config: RuntimeConfig;
  try {
    config = JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as RuntimeConfig;
  } catch (e) {
    console.error(`ERROR: Invalid JSON in ${CONFIG_FILE}: ${e}`);
    process.exit(1);
  }

  if (!config.accounts || Object.keys(config.accounts).length === 0) {
    console.error(`ERROR: No accounts defined in ${CONFIG_FILE}`);
    process.exit(1);
  }

  for (const accountCfg of Object.values(config.accounts)) {
    if ("rules" in accountCfg) {
      console.error(
        `ERROR: Legacy accounts.*.rules is no longer supported in ${CONFIG_FILE}. ` +
          `Move those entries into top-level mail_rules. See README for format.`,
      );
      process.exit(1);
    }
  }

  return config;
}

export function buildPipelineRules(config: RuntimeConfig): MailRule[] {
  return [...(config.mail_rules ?? [])];
}
