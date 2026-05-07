/**
 * Write monthly mail memory markdown files for the OpenClaw agent.
 *
 * Memory files live at:
 *   ~/.openclaw/agents/main/workspace/memory/mail/mail_memory_YYYY-MM.md
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync, } from "node:fs";
import { dirname, join } from "node:path";
import { getAnalysisFile, getLongTermMemoryDir, getStateFile, } from "./paths.js";
const GUID_NAMESPACE = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
export const BADGE_LABELS = {
    urgent: "🚨 Urgent",
    high: "⚠️ Important",
    medium: "📬 Medium",
    low: "📭 Low",
    junk: "🗑️ Junk",
    ad: "📢 Ad",
    unknown: "❓ Unknown",
};
function fmtDate(ds) {
    try {
        const dt = new Date(ds + "T00:00:00");
        if (isNaN(dt.getTime()))
            return ds;
        return dt.toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
        });
    }
    catch {
        return ds;
    }
}
/**
 * Deterministic GUID for a mailpiece (date + filename).
 * Produces a UUID v5-compatible string using SHA-1.
 */
export function makeGuid(dateStr, imageName) {
    const name = `${dateStr}/${imageName}`;
    const nsBytes = Buffer.from(GUID_NAMESPACE.replace(/-/g, ""), "hex");
    const hash = createHash("sha1")
        .update(nsBytes)
        .update(Buffer.from(name, "utf-8"))
        .digest();
    // Set version 5
    hash[6] = (hash[6] & 0x0f) | 0x50;
    // Set variant
    hash[8] = (hash[8] & 0x3f) | 0x80;
    const hex = hash.subarray(0, 16).toString("hex");
    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20, 32),
    ].join("-");
}
/**
 * Load accumulated analysis history.
 *
 * Handles two formats:
 *   - Flat: {date: {file: info}}
 *   - v2 nested: {"data": {date: {file: info}}, "_meta/...": ...}
 * Returns normalized date-keyed data.
 */
export function loadAnalysis(workspaceAgent) {
    const analysisFile = getAnalysisFile(workspaceAgent);
    if (!existsSync(analysisFile))
        return {};
    const raw = JSON.parse(readFileSync(analysisFile, "utf-8"));
    // v2 format wraps everything under a "data" key
    if (raw.data && typeof raw.data === "object") {
        const firstVal = Object.values(raw.data)[0];
        if (firstVal &&
            typeof firstVal === "object" &&
            Object.keys(firstVal).some((k) => k.endsWith(".jpg"))) {
            return raw.data;
        }
    }
    // Flat format or already clean
    const result = {};
    for (const [k, v] of Object.entries(raw)) {
        if (!k.startsWith("_meta") && typeof v === "object" && v !== null) {
            result[k] = v;
        }
    }
    return result;
}
/**
 * Atomic write of analysis history.
 */
export function saveAnalysis(data, workspaceAgent) {
    const analysisFile = getAnalysisFile(workspaceAgent);
    mkdirSync(dirname(analysisFile), { recursive: true });
    const tmp = analysisFile + ".tmp";
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, analysisFile);
}
/**
 * Merge new items into analysis.json for a given date.
 */
export function saveToAnalysis(dateStr, items, workspaceAgent) {
    const data = loadAnalysis(workspaceAgent);
    const existing = data[dateStr] ?? {};
    Object.assign(existing, items);
    data[dateStr] = existing;
    saveAnalysis(data, workspaceAgent);
}
/**
 * Update the monthly memory file with entries for a single date.
 */
export function writeMemoryForDate(dateStr, items, memoryAgent) {
    const month = dateStr.slice(0, 7); // YYYY-MM
    const memoryDir = getLongTermMemoryDir(memoryAgent);
    const memPath = join(memoryDir, `mail_memory_${month}.md`);
    mkdirSync(memoryDir, { recursive: true });
    let existingContent = "";
    if (existsSync(memPath)) {
        existingContent = readFileSync(memPath, "utf-8");
    }
    // If date already in file, skip (idempotent)
    if (existingContent.includes(`## ${fmtDate(dateStr)} (${dateStr})`)) {
        return memPath;
    }
    // Build the new date section
    const lines = [`\n## ${fmtDate(dateStr)} (${dateStr})\n`];
    for (const item of items) {
        const sender = item.sender ?? "Unknown";
        const addressee = item.addressee ?? "Unknown";
        const imp = item.importance ?? "unknown";
        const badge = BADGE_LABELS[imp] ?? imp;
        const mailClass = item.mail_class ?? "";
        const desc = item.description ?? "";
        const addrMethod = item.address_method ?? "";
        const mtype = item.type ?? "scan";
        const guid = item.guid ?? "";
        lines.push(`- **${sender}** → ${addressee}  `);
        const metaParts = [badge];
        if (mailClass)
            metaParts.push(mailClass);
        if (addrMethod)
            metaParts.push(addrMethod);
        if (mtype === "ad")
            metaParts.push("Ad");
        lines.push(`  ${metaParts.join(" | ")}  \n`);
        if (desc)
            lines.push(`  ${desc}  \n`);
        if (guid)
            lines.push(`  \`${guid.slice(0, 8)}\`  \n`);
    }
    const newSection = lines.join("");
    if (!existingContent) {
        // New file — add header
        const monthDate = new Date(month + "-01T00:00:00");
        const monthLabel = monthDate.toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
        });
        const header = `# Mail Memory — ${monthLabel}\n`;
        writeFileSync(memPath, header + newSection);
    }
    else {
        // Append at end
        appendFileSync(memPath, newSection);
    }
    return memPath;
}
/**
 * Search analysis history. Returns list of {date, filename, info} objects.
 */
export function lookup(options) {
    if (!options.workspaceAgent) {
        throw new Error("workspace_agent is required");
    }
    const data = loadAnalysis(options.workspaceAgent);
    const results = [];
    for (const [d, files] of Object.entries(data)) {
        if (options.date && !d.includes(options.date))
            continue;
        for (const [fname, info] of Object.entries(files)) {
            const entryGuid = info.guid ?? makeGuid(d, fname);
            if (options.guid && !entryGuid.includes(options.guid))
                continue;
            if (options.search) {
                const haystack = Object.values(info)
                    .map(String)
                    .join(" ")
                    .toLowerCase();
                if (!haystack.includes(options.search.toLowerCase()))
                    continue;
            }
            results.push({ date: d, filename: fname, info });
        }
    }
    return results;
}
/**
 * Compute statistics across all analyzed mail.
 */
export function getStats(workspaceAgent) {
    if (!workspaceAgent) {
        throw new Error("workspace_agent is required");
    }
    const data = loadAnalysis(workspaceAgent);
    let total = 0;
    const impTotals = {};
    const senderCounts = {};
    const addresseeCounts = {};
    for (const files of Object.values(data)) {
        for (const info of Object.values(files)) {
            total++;
            const imp = info.importance ?? "unknown";
            impTotals[imp] = (impTotals[imp] ?? 0) + 1;
            const s = info.sender ?? "Unknown";
            senderCounts[s] = (senderCounts[s] ?? 0) + 1;
            const a = info.addressee ?? "Unknown";
            addresseeCounts[a] = (addresseeCounts[a] ?? 0) + 1;
        }
    }
    const sortedImp = Object.fromEntries(Object.entries(impTotals).sort(([, a], [, b]) => b - a));
    const topSenders = Object.fromEntries(Object.entries(senderCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10));
    const topAddressees = Object.fromEntries(Object.entries(addresseeCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10));
    return {
        total_pieces: total,
        delivery_days: Object.keys(data).length,
        by_importance: sortedImp,
        top_senders: topSenders,
        top_addressees: topAddressees,
    };
}
// ---------------------------------------------------------------------------
// State tracking — last poll timestamp and processed message IDs
// ---------------------------------------------------------------------------
/**
 * Load workflow state (last_checked_at, processed message IDs, etc.).
 */
export function loadState(workspaceAgent) {
    const stateFile = getStateFile(workspaceAgent);
    if (!existsSync(stateFile))
        return {};
    return JSON.parse(readFileSync(stateFile, "utf-8"));
}
/**
 * Atomic write of workflow state.
 */
export function saveState(state, workspaceAgent) {
    const stateFile = getStateFile(workspaceAgent);
    mkdirSync(dirname(stateFile), { recursive: true });
    const tmp = stateFile + ".tmp";
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, stateFile);
}
/**
 * Update state after a successful run.
 */
export function updateState(options) {
    if (!options.workspaceAgent) {
        throw new Error("workspace_agent is required");
    }
    const state = loadState(options.workspaceAgent);
    state.last_checked_at =
        options.lastCheckedAt ?? new Date().toISOString();
    if (options.messageId) {
        state.last_message_id = options.messageId;
        const recent = state.processed_message_ids ?? [];
        if (!recent.includes(options.messageId)) {
            recent.push(options.messageId);
        }
        // Keep last 100
        state.processed_message_ids = recent.slice(-100);
    }
    if (options.dateProcessed) {
        state.last_date_processed = options.dateProcessed;
    }
    saveState(state, options.workspaceAgent);
}
