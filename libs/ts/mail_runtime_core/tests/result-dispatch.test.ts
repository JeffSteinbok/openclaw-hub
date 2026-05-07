import { describe, it, expect, vi } from "vitest";
import { dispatchResults } from "../src/result-dispatch.js";
import type { ActionResult } from "../src/runtime.js";

describe("dispatchResults", () => {
  it("log kind", () => {
    const logger = vi.fn();
    const results: ActionResult[] = [{ kind: "log", payload: { message: "hello" } }];
    dispatchResults(results, { logger });
    expect(logger).toHaveBeenCalledWith("hello");
  });

  it("known handler", () => {
    const logger = vi.fn();
    const handler = vi.fn();
    const results: ActionResult[] = [{ kind: "message", payload: { text: "hi" } }];
    dispatchResults(results, { logger, handlers: { message: handler } });
    expect(handler).toHaveBeenCalledWith({ text: "hi" });
    expect(logger).not.toHaveBeenCalled();
  });

  it("unknown kind warning", () => {
    const logger = vi.fn();
    const results: ActionResult[] = [{ kind: "alien", payload: { x: 1 } }];
    dispatchResults(results, { logger });
    expect(logger).toHaveBeenCalledOnce();
    expect(logger.mock.calls[0][0].toLowerCase()).toContain("unknown");
  });

  it("multiple results", () => {
    const logger = vi.fn();
    const handler = vi.fn();
    const results: ActionResult[] = [
      { kind: "log", payload: { message: "a" } },
      { kind: "notify", payload: { msg: "b" } },
      { kind: "unknown_thing", payload: {} },
    ];
    dispatchResults(results, { logger, handlers: { notify: handler } });
    expect(logger).toHaveBeenCalledTimes(2); // log + unknown warning
    expect(handler).toHaveBeenCalledWith({ msg: "b" });
  });

  it("empty results", () => {
    const logger = vi.fn();
    dispatchResults([], { logger });
    expect(logger).not.toHaveBeenCalled();
  });

  it("no handlers dict", () => {
    const logger = vi.fn();
    const results: ActionResult[] = [{ kind: "custom", payload: { k: "v" } }];
    dispatchResults(results, { logger });
    expect(logger.mock.calls[0][0].toLowerCase()).toContain("unknown");
  });
});
