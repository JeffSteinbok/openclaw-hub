import { createPythonPlugin } from "@local/openclaw-python-framework";

const plugin = {
  id: "outlook-calendar",
  name: "Outlook Calendar",
  description: "Fetch upcoming events from Outlook personal and family calendars",
  configSchema: { type: "object" as const, additionalProperties: false, properties: {} },
  register(api: any) {
    createPythonPlugin(api, { script: new URL("./tools.py", import.meta.url) });
  },
};

export default plugin;
