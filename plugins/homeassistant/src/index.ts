import { createPythonPlugin } from "@local/openclaw-python-framework";

const plugin = {
  id: "homeassistant",
  name: "Home Assistant",
  description: "Control devices, query state, and inspect activity in Home Assistant",
  configSchema: { type: "object" as const, additionalProperties: false, properties: {} },
  register(api: any) {
    createPythonPlugin(api, { script: new URL("./tools.py", import.meta.url) });
  },
};

export default plugin;
