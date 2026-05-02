import { createPythonPlugin } from "@local/openclaw-python-framework";

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    server: { type: "string" as const, description: "Home Assistant server URL" },
    token: { type: "string" as const, description: "Home Assistant long-lived access token" },
  },
};

const plugin = {
  id: "llmvision",
  name: "Home Assistant – LLM Vision",
  description: "Home Assistant LLM Vision integration: analyze camera images with AI, query the vision timeline, and create timeline events.",
  configSchema,
  register(api: any) {
    createPythonPlugin(api, { script: new URL("./tools.py", import.meta.url) });
  },
};

export default plugin;
