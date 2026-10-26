/** Purposes must be namespaced (`<namespace>.<gate>`) so provenance shows which caller asked. */
const PURPOSE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const QUESTION_TYPES = new Set(["boolean", "choice", "score"]);
const MAX_TIMEOUT_MS = 30_000;

export type DecideParams = {
  agentId: string;
  purpose: string;
  rubricVersion: string;
  request: { state: Record<string, unknown>; questions: Record<string, { type: string }> };
  timeoutMs: number;
};

/** Checks decisions-bridge.evaluate params. Returns the cleaned params or an error message. */
export function validate(raw: unknown, allowedAgents: Set<string>): DecideParams | string {
  const p = (raw ?? {}) as Record<string, unknown>;
  const agentId = typeof p.agentId === "string" ? p.agentId.trim() : "";
  if (!agentId) return "agentId is required";
  if (!allowedAgents.has(agentId)) return `agent ${agentId} is not allowed to use decisions-bridge.evaluate`;
  const purpose = typeof p.purpose === "string" ? p.purpose.trim() : "";
  if (!PURPOSE.test(purpose)) return "purpose must be namespaced, like <namespace>.<gate>";
  const rubricVersion = typeof p.rubricVersion === "string" && p.rubricVersion.trim() ? p.rubricVersion.trim() : "1";

  const request = p.request as DecideParams["request"] | undefined;
  if (!request || typeof request !== "object") return "request is required";
  if (!request.state || typeof request.state !== "object" || Array.isArray(request.state)) return "request.state must be an object";
  const questions = request.questions;
  if (!questions || typeof questions !== "object" || Object.keys(questions).length === 0) return "request.questions must name at least one question";
  for (const [id, q] of Object.entries(questions)) {
    if (!q || !QUESTION_TYPES.has((q as { type?: string }).type ?? "")) return `question ${id} needs type boolean, choice or score`;
  }

  const t = typeof p.timeoutMs === "number" && p.timeoutMs > 0 ? Math.min(p.timeoutMs, MAX_TIMEOUT_MS) : 15_000;
  return { agentId, purpose, rubricVersion, request, timeoutMs: t };
}

/** What the caller gets back: answers when ok, otherwise why not. Never throws. */
export function shape(outcome: any): Record<string, unknown> {
  if (outcome?.status !== "ok") return { status: "unavailable", reason: outcome?.reason ?? "unknown" };
  return {
    status: "ok",
    answers: outcome.result?.answers ?? {},
    ...(outcome.result?.model ? { model: outcome.result.model } : {}),
  };
}
