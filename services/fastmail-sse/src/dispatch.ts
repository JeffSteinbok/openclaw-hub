/**
 * Result dispatch and delivery via subprocess.
 */

import { execFileSync } from "node:child_process";
import { dispatchResults as dispatchActionResults } from "carapace-mail-runtime";
import type { ActionResult } from "carapace-mail-runtime";
import { log } from "./config.js";

// ── Delivery ─────────────────────────────────────────────────

export function deliver(
  msg: string,
  channel: string,
  target: string,
): void {
  try {
    execFileSync(
      "openclaw",
      ["message", "send", "--channel", channel, "--target", target, "--message", msg],
      { timeout: 30_000, stdio: "pipe" },
    );
    log(`delivered: ${msg}`);
  } catch (e: unknown) {
    const err = e as { status?: number; stderr?: Buffer | string; message?: string };
    if (err.stderr) {
      log(
        `error: message send returned ${err.status ?? "?"}: ${String(err.stderr).slice(0, 200)}`,
      );
    } else {
      log(`error: delivery failed: ${err.message ?? e}`);
    }
  }
}

// ── Agent handoff ────────────────────────────────────────────

export function handoffToAgent(agent: string, message: string): void {
  try {
    execFileSync(
      "openclaw",
      [
        "agent",
        "--agent",
        agent,
        "--json",
        "--timeout",
        "120",
        "--message",
        message,
      ],
      { timeout: 150_000, stdio: "pipe" },
    );
    log(`handoff delivered to agent ${agent}`);
  } catch (e: unknown) {
    const err = e as { stderr?: Buffer | string; message?: string };
    if (err.stderr) {
      log(`error: agent handoff failed: ${String(err.stderr).slice(0, 200)}`);
    } else {
      log(`error: agent handoff failed: ${err.message ?? e}`);
    }
  }
}

// ── Dispatch results ─────────────────────────────────────────

export function dispatchResults(
  results: ActionResult[],
  config: { channel: string; target: string },
): void {
  dispatchActionResults(results, {
    logger: log,
    handlers: {
      message: (payload) =>
        deliver(
          payload["message"] as string,
          config.channel,
          config.target,
        ),
      agent_handoff: (payload) =>
        handoffToAgent(
          (payload["agent"] as string) ?? "main",
          payload["message"] as string,
        ),
    },
  });
}
