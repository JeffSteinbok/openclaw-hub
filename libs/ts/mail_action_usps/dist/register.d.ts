/**
 * USPS mail action registration for the shared mail runtime.
 */
import type { ActionContext, ActionRegistry, ActionResult } from "@openclaw/mail-runtime-core";
/**
 * Run the USPS analyzer on downloaded digest assets and hand results to the configured agent.
 */
export declare function processUspsDigestAction(ctx: ActionContext, params: Record<string, unknown>): Promise<ActionResult[]>;
/**
 * Register USPS mail actions on a shared mail action registry.
 */
export declare function registerUspsActions(registry: ActionRegistry): void;
