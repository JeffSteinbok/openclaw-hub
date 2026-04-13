import { createPythonPlugin } from "@local/openclaw-python-framework";

const plugin = {
  id: "outlook-mail",
  name: "Outlook Mail",
  description: "Search and read messages from Outlook inboxes",
  configSchema: { type: "object" as const, additionalProperties: false, properties: {} },
  register(api: any) {
    createPythonPlugin(api, { script: new URL("./tools.py", import.meta.url) });
  },
};

export default plugin;
