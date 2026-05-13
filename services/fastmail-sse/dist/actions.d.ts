/**
 * Action registration — built-in + tracking + USPS actions.
 */
import type { ActionRegistry } from "carapace-mail-runtime";
import type { AccountConfig } from "./config.js";
export declare function registerActions(registry: ActionRegistry, accountConfig: Record<string, AccountConfig>, accountIds: string[], inboxIds: string[], mailboxNames: Record<string, string>): void;
