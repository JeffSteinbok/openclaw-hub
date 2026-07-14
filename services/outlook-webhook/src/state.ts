/**
 * State persistence — subscription ID and expiry.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { STATE_FILE, log } from "./config.js";

export interface OutlookSseState {
  subscriptionId?: string;
  expirationDateTime?: string;
  [key: string]: unknown;
}

export function loadState(): OutlookSseState {
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as OutlookSseState;
    } catch {
      log("warn: corrupt state file, resetting");
    }
  }
  return {};
}

export function saveState(state: OutlookSseState): void {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  const tmp = STATE_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, STATE_FILE);
}

export function clearState(): void {
  saveState({});
}
