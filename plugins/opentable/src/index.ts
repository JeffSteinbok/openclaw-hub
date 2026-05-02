import { createPythonPlugin } from "@local/openclaw-python-framework";

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    availabilityHash: {
      type: "string" as const,
      description: "Persisted-query hash used for OpenTable availability requests",
    },
    notifyChannel: {
      type: "string" as const,
      description: "Notification channel for heartbeat alerts",
      default: "discord",
    },
    notifyTarget: {
      type: "string" as const,
      description: "Notification target for heartbeat alerts",
    },
  },
};

const plugin = {
  id: "opentable",
  name: "OpenTable",
  description: "Check restaurant availability on OpenTable",
  configSchema,
  register(api: any) {
    createPythonPlugin(api, { script: new URL("./tools.py", import.meta.url) });
  },
};

export default plugin;
