/**
 * Write monthly mail memory markdown files for the OpenClaw agent.
 *
 * Memory files live at:
 *   ~/.openclaw/agents/main/workspace/memory/mail/mail_memory_YYYY-MM.md
 */
export declare const BADGE_LABELS: Record<string, string>;
/**
 * Deterministic GUID for a mailpiece (date + filename).
 * Produces a UUID v5-compatible string using SHA-1.
 */
export declare function makeGuid(dateStr: string, imageName: string): string;
export interface AnalysisData {
    [date: string]: Record<string, Record<string, unknown>>;
}
/**
 * Load accumulated analysis history.
 *
 * Handles two formats:
 *   - Flat: {date: {file: info}}
 *   - v2 nested: {"data": {date: {file: info}}, "_meta/...": ...}
 * Returns normalized date-keyed data.
 */
export declare function loadAnalysis(workspaceAgent: string): AnalysisData;
/**
 * Atomic write of analysis history.
 */
export declare function saveAnalysis(data: AnalysisData, workspaceAgent: string): void;
/**
 * Merge new items into analysis.json for a given date.
 */
export declare function saveToAnalysis(dateStr: string, items: Record<string, Record<string, unknown>>, workspaceAgent: string): void;
export interface MemoryItem {
    sender?: string;
    addressee?: string;
    description?: string;
    importance?: string;
    mail_class?: string;
    address_method?: string;
    type?: string;
    guid?: string;
    [key: string]: unknown;
}
/**
 * Update the monthly memory file with entries for a single date.
 */
export declare function writeMemoryForDate(dateStr: string, items: MemoryItem[], memoryAgent: string): string;
export interface LookupResult {
    date: string;
    filename: string;
    info: Record<string, unknown>;
}
/**
 * Search analysis history. Returns list of {date, filename, info} objects.
 */
export declare function lookup(options: {
    guid?: string;
    date?: string;
    search?: string;
    workspaceAgent?: string;
}): LookupResult[];
export interface MailStats {
    total_pieces: number;
    delivery_days: number;
    by_importance: Record<string, number>;
    top_senders: Record<string, number>;
    top_addressees: Record<string, number>;
}
/**
 * Compute statistics across all analyzed mail.
 */
export declare function getStats(workspaceAgent?: string): MailStats;
/**
 * Load workflow state (last_checked_at, processed message IDs, etc.).
 */
export declare function loadState(workspaceAgent: string): Record<string, unknown>;
/**
 * Atomic write of workflow state.
 */
export declare function saveState(state: Record<string, unknown>, workspaceAgent: string): void;
/**
 * Update state after a successful run.
 */
export declare function updateState(options: {
    lastCheckedAt?: string;
    messageId?: string;
    dateProcessed?: string;
    workspaceAgent?: string;
}): void;
