import { createPythonPlugin } from "@local/openclaw-python-framework";

const plugin = {
  id: "opentable",
  name: "OpenTable",
  description: "Check restaurant availability on OpenTable",
  configSchema: { type: "object" as const, additionalProperties: false, properties: {} },
  register(api: any) {
    createPythonPlugin(api, { script: new URL("./tools.py", import.meta.url) });
  },
};

export default plugin;
