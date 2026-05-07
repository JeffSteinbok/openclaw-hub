/**
 * Result dispatch and delivery via subprocess.
 */
import type { ActionResult } from "@openclaw/mail-runtime-core";
export declare function deliver(msg: string, channel: string, target: string): void;
export declare function handoffToAgent(agent: string, message: string): void;
export declare function dispatchResults(results: ActionResult[], config: {
    channel: string;
    target: string;
}): void;
