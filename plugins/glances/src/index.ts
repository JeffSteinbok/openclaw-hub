import { createPythonPlugin } from "@local/openclaw-python-framework";

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    url: {
      type: "string",
      description: "Base URL for the Glances web server, e.g. http://127.0.0.1:61208",
      default: "http://127.0.0.1:61208",
    },
  },
};

const plugin = {
  id: "glances",
  name: "Glances",
  description: "Read CPU, memory, disk, and summary metrics from a Glances server",
  configSchema,
  register(api: any) {
    const configuredUrl = api.pluginConfig?.url;
    if (typeof configuredUrl === "string" && configuredUrl.trim()) {
      process.env.GLANCES_BASE_URL = configuredUrl.trim();
    }

    createPythonPlugin(api, { script: new URL("./tools.py", import.meta.url) });
  },
};

export default plugin;
