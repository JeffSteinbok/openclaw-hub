/**
 * Structured mail pipeline logger.
 *
 * Writes one JSONL entry per processed email to:
 *   ~/.openclaw/logs/mail-pipeline/YYYY-MM-DD.jsonl
 *
 * Rotation: one file per day; files older than RETENTION_DAYS are pruned
 * automatically on each new-day rollover.
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MailEnvelope, ActionResult } from "carapace-mail-runtime";
import type { MailRule } from "./config.js";
import { log } from "./config.js";

// ── Config ───────────────────────────────────────────────────

const LOG_DIR = join(homedir(), ".openclaw/logs/mail-pipeline");
const RETENTION_DAYS = 30;

// ── Types ────────────────────────────────────────────────────

export interface PipelineLogEntry {
  ts: string;                       // ISO-8601 UTC timestamp
  message_id: string;               // JMAP email id (truncated to 16 chars)
  account_id: string;               // account id (first 8 chars)
  sender_email: string;
  subject: string;
  matched_rules: string[];          // rule ids that matched
  actions_fired: string[];          // action names that ran
  results: Array<{ kind: string; summary: string }>;  // what was dispatched
}

// ── Internal state ───────────────────────────────────────────

let _currentDay = "";              // YYYY-MM-DD of the currently open log file
let _currentPath = "";

// ── Helpers ──────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function logPath(day: string): string {
  return join(LOG_DIR, `${day}.jsonl`);
}

/**
 * Prune log files older than RETENTION_DAYS.
 * Called once per day when the file rolls over.
 */
function pruneOldLogs(): void {
  try {
    const files = readdirSync(LOG_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f));
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const f of files) {
      const p = join(LOG_DIR, f);
      try {
        const { mtimeMs } = statSync(p);
        if (mtimeMs < cutoff) {
          rmSync(p);
          log(`mail-logger: pruned old log ${f}`);
        }
      } catch {
        // ignore individual file errors
      }
    }
  } catch {
    // ignore if LOG_DIR doesn't exist yet
  }
}

/**
 * Ensure the log directory exists and roll over to today's file if needed.
 */
function ensureReady(): string {
  const today = todayStr();
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  if (today !== _currentDay) {
    // New day — roll over
    if (_currentDay !== "") {
      pruneOldLogs();
    }
    _currentDay = today;
    _currentPath = logPath(today);
  }
  return _currentPath;
}

// ── Summary helpers ──────────────────────────────────────────

function summariseResult(result: ActionResult): string {
  const p = result.payload;
  if (result.kind === "message") {
    const msg = (p["message"] as string | undefined) ?? "";
    return msg.slice(0, 120);
  }
  if (result.kind === "agent_handoff") {
    const agent = (p["agent"] as string | undefined) ?? "?";
    const session = (p["session"] as string | undefined);
    return session ? `agent=${agent} session=${session}` : `agent=${agent}`;
  }
  // Generic fallback — include all payload keys
  return Object.entries(p)
    .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`)
    .join(" ");
}

function actionsFromRules(matchedRules: MailRule[]): string[] {
  const names: string[] = [];
  for (const rule of matchedRules) {
    for (const a of rule.actions ?? []) {
      names.push(typeof a === "string" ? a : ((a as Record<string, unknown>)["name"] as string) ?? "?");
    }
  }
  return names;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Write a structured log entry for one processed email.
 *
 * @param envelope   The mail envelope (pre- or post-body-fetch is fine)
 * @param matched    Rules that matched (from executeRules return value)
 * @param results    ActionResults produced (from executeRules return value)
 */
export function logPipelineEvent(
  envelope: MailEnvelope,
  matched: MailRule[],
  results: ActionResult[],
): void {
  try {
    const path = ensureReady();
    const entry: PipelineLogEntry = {
      ts: new Date().toISOString(),
      message_id: envelope.message_id.slice(0, 16),
      account_id: envelope.account_id.slice(0, 8),
      sender_email: envelope.sender_email,
      subject: (envelope.subject ?? "").slice(0, 200),
      matched_rules: matched.map((r) => (r.id as string) ?? "<unnamed>"),
      actions_fired: actionsFromRules(matched),
      results: results.map((r) => ({ kind: r.kind, summary: summariseResult(r) })),
    };
    appendFileSync(path, JSON.stringify(entry) + "\n", "utf-8");
  } catch (e) {
    log(`mail-logger: write failed: ${e}`);
  }
}
