/**
 * Action registration — built-in + USPS actions.
 */
import type { ActionRegistry } from "@openclaw/mail-runtime-core";
import type { AccountConfig } from "./config.js";
export declare function registerActions(registry: ActionRegistry, accountConfig: Record<string, AccountConfig>, accountIds: string[], inboxIds: string[], mailboxNames: Record<string, string>): void;
