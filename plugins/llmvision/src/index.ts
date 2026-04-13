import { createPythonPlugin } from "@local/openclaw-python-framework";

const plugin = {
  id: "llmvision",
  name: "Home Assistant – LLM Vision",
  description: "Home Assistant LLM Vision integration: analyze camera images with AI, query the vision timeline, and create timeline events.",
  configSchema: { type: "object" as const, additionalProperties: false, properties: {} },
  register(api: any) {
    createPythonPlugin(api, { script: new URL("./tools.py", import.meta.url) });
  },
};

export default plugin;
