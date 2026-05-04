/**
 * State persistence — atomic JSON read/write.
 */
export interface SseState {
    EmailStates?: Record<string, string>;
    Email?: string;
    [key: string]: unknown;
}
export declare function loadState(): SseState;
export declare function saveState(state: SseState): void;
