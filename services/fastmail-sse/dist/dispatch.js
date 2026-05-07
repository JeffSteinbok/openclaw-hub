/**
 * Result dispatch and delivery via subprocess.
 */
import { execFileSync } from "node:child_process";
import { dispatchResults as dispatchActionResults } from "@openclaw/mail-runtime-core";
import { log } from "./config.js";
// ── Delivery ─────────────────────────────────────────────────
export function deliver(msg, channel, target) {
    try {
        execFileSync("openclaw", ["message", "send", "--channel", channel, "--target", target, "--message", msg], { timeout: 30_000, stdio: "pipe" });
        log(`delivered: ${msg}`);
    }
    catch (e) {
        const err = e;
        if (err.stderr) {
            log(`error: message send returned ${err.status ?? "?"}: ${String(err.stderr).slice(0, 200)}`);
        }
        else {
            log(`error: delivery failed: ${err.message ?? e}`);
        }
    }
}
// ── Agent handoff ────────────────────────────────────────────
export function handoffToAgent(agent, message) {
    try {
        execFileSync("openclaw", [
            "agent",
            "--agent",
            agent,
            "--json",
            "--timeout",
            "120",
            "--message",
            message,
        ], { timeout: 150_000, stdio: "pipe" });
        log(`handoff delivered to agent ${agent}`);
    }
    catch (e) {
        const err = e;
        if (err.stderr) {
            log(`error: agent handoff failed: ${String(err.stderr).slice(0, 200)}`);
        }
        else {
            log(`error: agent handoff failed: ${err.message ?? e}`);
        }
    }
}
// ── Dispatch results ─────────────────────────────────────────
export function dispatchResults(results, config) {
    dispatchActionResults(results, {
        logger: log,
        handlers: {
            message: (payload) => deliver(payload["message"], config.channel, config.target),
            agent_handoff: (payload) => handoffToAgent(payload["agent"] ?? "main", payload["message"]),
        },
    });
}
