import { createPythonPlugin } from "@local/openclaw-python-framework";

const plugin = {
  id: "config-backup",
  name: "Config Backup",
  description: "Backs up OpenClaw config to Git with SHA-256 change detection",
  configSchema: { type: "object" as const, additionalProperties: false, properties: {} },
  register(api: any) {
    createPythonPlugin(api, { script: new URL("./tools.py", import.meta.url) });
  },
};

export default plugin;
