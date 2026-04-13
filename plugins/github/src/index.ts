import { createPythonPlugin } from "@local/openclaw-python-framework";

const plugin = {
  id: "github",
  name: "GitHub",
  description: "Manage GitHub issues. Create, read, update, close, comment on, and list issues.",
  configSchema: { type: "object" as const, additionalProperties: false, properties: {} },
  register(api: any) {
    createPythonPlugin(api, { script: new URL("./tools.py", import.meta.url) });
  },
};

export default plugin;
