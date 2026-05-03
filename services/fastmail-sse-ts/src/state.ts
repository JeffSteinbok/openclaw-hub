/**
 * State persistence — atomic JSON read/write.
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

export interface SseState {
  EmailStates?: Record<string, string>;
  Email?: string;
  [key: string]: unknown;
}

export function loadState(): SseState {
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as SseState;
    } catch {
      log("warn: corrupt state file, resetting");
    }
  }
  return {};
}

export function saveState(state: SseState): void {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  const tmp = STATE_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, STATE_FILE);
}
