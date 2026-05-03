/**
 * Shared ActionResult dispatch helpers.
 * TS port of mail_runtime_core/result_dispatch.py
 */

import type { ActionResult } from "./runtime.js";

export function dispatchResults(
  results: ActionResult[],
  options: {
    logger: (msg: string) => void;
    handlers?: Record<string, (payload: Record<string, unknown>) => void>;
  },
): void {
  const { logger, handlers = {} } = options;

  for (const result of results) {
    if (result.kind === "log") {
      logger(result.payload["message"] as string);
      continue;
    }

    const handler = handlers[result.kind];
    if (handler === undefined) {
      logger(`warn: unknown action result kind ${result.kind}`);
      continue;
    }

    handler(result.payload);
  }
}
