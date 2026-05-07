/**
 * Notification routing for USPS mail alerts.
 *
 * Routes notifications to different recipients based on the addressee.
 * Config lives at ~/.openclaw/agents/mail/workspace/usps-mail/config.json.
 * Notifications are planned first, then optionally delivered via `openclaw message send`.
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { getConfigFile } from "./paths.js";
const NICOLE_PATTERNS = new Set(["nicole", "eastside improv"]);
/**
 * Load plugin config (routing, etc.).
 */
export function loadConfig(workspaceAgent) {
    if (!workspaceAgent) {
        throw new Error("workspace_agent is required");
    }
    const configFile = getConfigFile(workspaceAgent);
    if (existsSync(configFile)) {
        return JSON.parse(readFileSync(configFile, "utf-8"));
    }
    return {};
}
/**
 * Determine routing key from addressee name.
 */
export function classifyRecipient(addressee) {
    const low = (addressee ?? "").toLowerCase();
    for (const pat of NICOLE_PATTERNS) {
        if (low.includes(pat)) {
            // Joint mail ("Jeffrey & Nicole") → jeff
            if (low.includes("jeff") || low.includes("jeffrey")) {
                return "jeff";
            }
            return "nicole";
        }
    }
    return "jeff";
}
/**
 * Send a notification via openclaw message send.
 */
export function sendMessage(message, channel, target) {
    if (!target) {
        process.stderr.write(`[NOTIFY] no target: ${message}\n`);
        return false;
    }
    try {
        execFileSync("openclaw", ["message", "send", "--channel", channel, "--target", target, "--message", message], { timeout: 30000, stdio: ["pipe", "pipe", "pipe"] });
        return true;
    }
    catch {
        process.stderr.write(`[NOTIFY] send failed: ${message.slice(0, 100)}\n`);
        return false;
    }
}
/**
 * Build per-recipient USPS notification payloads without sending them.
 */
export function buildNotificationPlan(dateStr, items, options) {
    const opts = options ?? {};
    if (!opts.config && !opts.workspaceAgent) {
        throw new Error("workspace_agent is required when config is not provided");
    }
    const config = opts.config ?? loadConfig(opts.workspaceAgent);
    let routing = config.routing;
    const defaultChannel = "discord";
    if (!routing || Object.keys(routing).length === 0) {
        routing = {
            default: {
                channel: process.env.NOTIFY_CHANNEL ?? "discord",
                target: process.env.NOTIFY_TARGET ?? "",
            },
        };
    }
    // Bucket items by recipient
    const buckets = {};
    for (const item of items) {
        const key = classifyRecipient(item.addressee);
        if (!buckets[key])
            buckets[key] = [];
        buckets[key].push(item);
    }
    const results = [];
    const otherItems = items.filter((it) => ["low", "junk", "ad", "medium"].includes(it.importance));
    for (const [key, keyItems] of Object.entries(buckets)) {
        const dest = routing[key] ?? routing.default;
        if (!dest)
            continue;
        const notifyItems = keyItems.filter((it) => ["urgent", "high"].includes(it.importance));
        if (notifyItems.length === 0)
            continue;
        const lines = [
            `📬 USPS Mail (${dateStr}) — ${notifyItems.length} important for you:`,
        ];
        for (const item of notifyItems) {
            const sender = item.sender ?? "Unknown";
            const desc = item.description ?? "";
            const imp = (item.importance ?? "").toUpperCase();
            let line = `  🔴 [${imp}] ${sender}`;
            if (desc)
                line += `: ${desc}`;
            lines.push(line);
        }
        // Junk/routine summary for Jeff only
        if (key !== "nicole" && otherItems.length > 0) {
            const junk = otherItems.filter((it) => ["junk", "ad"].includes(it.importance)).length;
            const rest = otherItems.length - junk;
            const parts = [];
            if (rest)
                parts.push(`${rest} routine`);
            if (junk)
                parts.push(`${junk} junk`);
            if (parts.length > 0) {
                lines.push(`  Also: ${parts.join(", ")}`);
            }
        }
        const msg = lines.join("\n");
        const channel = dest.channel ?? defaultChannel;
        const target = dest.target ?? "";
        results.push({
            recipient: key,
            target,
            channel,
            message: msg,
            items: notifyItems,
        });
    }
    return results;
}
/**
 * Route important items to the right recipients and send notifications.
 */
export function routeAndNotify(dateStr, items, options) {
    const opts = options ?? {};
    if (!opts.workspaceAgent) {
        throw new Error("workspace_agent is required");
    }
    const plan = buildNotificationPlan(dateStr, items, {
        workspaceAgent: opts.workspaceAgent,
    });
    const results = [];
    for (const entry of plan) {
        let sent = false;
        if (opts.dryRun) {
            process.stderr.write(`[DRY RUN → ${entry.recipient}/${entry.target}]\n${entry.message}\n\n`);
        }
        else {
            sent = sendMessage(entry.message, entry.channel, entry.target);
        }
        results.push({ ...entry, sent });
    }
    return results;
}
