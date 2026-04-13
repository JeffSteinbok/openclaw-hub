import { createPythonPlugin } from "@local/openclaw-python-framework";

const plugin = {
  id: "fastmail",
  name: "FastMail tools",
  description: "Send email and manage calendar events in Fastmail",
  configSchema: { type: "object" as const, additionalProperties: false, properties: {} },
  register(api: any) {
    createPythonPlugin(api, { script: new URL("./tools.py", import.meta.url) });
  },
};

export default plugin;
