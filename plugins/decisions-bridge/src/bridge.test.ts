import { describe, expect, it } from "vitest";
import { shape, validate } from "./bridge.js";

const agents = new Set(["root"]);
const good = {
  agentId: "root",
  purpose: "octo.session-labels",
  request: { state: { text: "hi" }, questions: { label: { type: "choice", criteria: { a: "A", b: "B" } } } },
};

describe("validate", () => {
  it("accepts a well-formed call and fills defaults", () => {
    const v = validate(good, agents);
    expect(typeof v).toBe("object");
    expect(v).toMatchObject({ agentId: "root", rubricVersion: "1", timeoutMs: 15_000 });
  });

  it("refuses agents that aren't configured", () => {
    expect(validate({ ...good, agentId: "main" }, agents)).toMatch(/not allowed/);
    expect(validate({ ...good, agentId: "" }, agents)).toMatch(/required/);
  });

  it("requires a namespaced purpose", () => {
    expect(validate({ ...good, purpose: "triage" }, agents)).toMatch(/purpose/);
  });

  it("checks questions and caps the timeout", () => {
    expect(validate({ ...good, request: { state: {}, questions: {} } }, agents)).toMatch(/at least one/);
    expect(validate({ ...good, request: { state: {}, questions: { q: { type: "essay" } } } }, agents)).toMatch(/type/);
    expect(validate({ ...good, request: { state: [], questions: good.request.questions } }, agents)).toMatch(/state/);
    expect(validate({ ...good, timeoutMs: 999_999 }, agents)).toMatchObject({ timeoutMs: 30_000 });
  });
});

it("hands the host a plain-JSON copy of the request", () => {
  const state = {};
  Object.defineProperty(state, "text", { get: () => "hi", enumerable: true });
  const v = validate({ ...good, request: { state, questions: good.request.questions } }, agents);
  if (typeof v === "string") throw new Error(v);
  const d = Object.getOwnPropertyDescriptor(v.request.state, "text");
  expect(d && "value" in d).toBe(true);
  expect(Object.getPrototypeOf(v.request.state)).toBe(Object.prototype);
});

describe("shape", () => {
  it("passes answers through when ok", () => {
    const answers = { label: { type: "choice", choice: "a", probabilities: { a: 0.9, b: 0.1 } } };
    expect(shape({ status: "ok", result: { answers, model: "jev" } })).toEqual({ status: "ok", answers, model: "jev" });
  });

  it("reports unavailable with a reason", () => {
    expect(shape({ status: "unavailable", reason: "no decision model" })).toEqual({ status: "unavailable", reason: "no decision model" });
    expect(shape(undefined)).toEqual({ status: "unavailable", reason: "unknown" });
  });
});
