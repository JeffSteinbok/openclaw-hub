/**
 * Logger — structured logging for the obsidian-indexer service.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const currentLevel: LogLevel =
  (process.env["LOG_LEVEL"] as LogLevel) ?? "info";

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function timestamp(): string {
  return new Date().toISOString();
}

export const log = {
  debug(msg: string, data?: Record<string, unknown>) {
    if (shouldLog("debug")) {
      console.log(`${timestamp()} [debug] ${msg}`, data ? JSON.stringify(data) : "");
    }
  },
  info(msg: string, data?: Record<string, unknown>) {
    if (shouldLog("info")) {
      console.log(`${timestamp()} [info] ${msg}`, data ? JSON.stringify(data) : "");
    }
  },
  warn(msg: string, data?: Record<string, unknown>) {
    if (shouldLog("warn")) {
      console.warn(`${timestamp()} [warn] ${msg}`, data ? JSON.stringify(data) : "");
    }
  },
  error(msg: string, data?: Record<string, unknown>) {
    if (shouldLog("error")) {
      console.error(`${timestamp()} [error] ${msg}`, data ? JSON.stringify(data) : "");
    }
  },
};
