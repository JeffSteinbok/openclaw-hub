/**
 * Shared ActionResult dispatch helpers.
 * TS port of mail_runtime_core/result_dispatch.py
 */
export function dispatchResults(results, options) {
    const { logger, handlers = {} } = options;
    for (const result of results) {
        if (result.kind === "log") {
            logger(result.payload["message"]);
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
