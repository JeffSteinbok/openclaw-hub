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
  id: "homeassistant",
  name: "Home Assistant",
  description: "Control devices, query state, and inspect activity in Home Assistant",
  configSchema,
  register(api: any) {
    createPythonPlugin(api, { script: new URL("./tools.py", import.meta.url) });
  },
};

export default plugin;
