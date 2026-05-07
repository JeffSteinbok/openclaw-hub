/**
 * Shared ActionResult dispatch helpers.
 * TS port of mail_runtime_core/result_dispatch.py
 */
import type { ActionResult } from "./runtime.js";
export declare function dispatchResults(results: ActionResult[], options: {
    logger: (msg: string) => void;
    handlers?: Record<string, (payload: Record<string, unknown>) => void>;
}): void;
