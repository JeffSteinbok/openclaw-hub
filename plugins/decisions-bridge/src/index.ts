import { shape, validate } from "./bridge.js";

export default {
  id: "decisions-bridge",
  name: "Decisions Bridge",
  description: "Lets scripts ask an agent's decision model a typed question through the decisions-bridge.evaluate Gateway method.",
  activation: { onStartup: true },
  register(api: any) {
    const raw = api.pluginConfig?.agents;
    const agents = new Set<string>(Array.isArray(raw) ? raw.filter((a: unknown): a is string => typeof a === "string") : []);

    // Scripts call this with `openclaw gateway call decisions-bridge.evaluate --params <json>`.
    // Write scope: each call can cost money and sends its state to the provider.
    api.registerGatewayMethod(
      "decisions-bridge.evaluate",
      async ({ params, respond }: { params: unknown; respond: (ok: boolean, data?: unknown, error?: unknown) => void }) => {
        const checked = validate(params, agents);
        if (typeof checked === "string") {
          respond(false, undefined, { code: "invalid_params", message: checked });
          return;
        }
        try {
          const outcome = await api.runtime.decisions.evaluate(checked.request, {
            agentId: checked.agentId,
            purpose: checked.purpose,
            rubricVersion: checked.rubricVersion,
            timeoutMs: checked.timeoutMs,
            // Required by the host; a Gateway call has no run signal of its own.
            signal: AbortSignal.timeout(checked.timeoutMs + 1_000),
          });
          respond(true, shape(outcome));
        } catch (e) {
          respond(true, { status: "unavailable", reason: (e as Error).message });
        }
      },
      { scope: "operator.write" },
    );
  },
};
