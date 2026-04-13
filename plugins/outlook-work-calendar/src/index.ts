import { createPythonPlugin } from "@local/openclaw-python-framework";

const plugin = {
  id: "outlook-work-calendar",
  name: "Outlook Work Calendar",
  description: "Fetch upcoming events from a published Outlook work calendar",
  configSchema: { type: "object" as const, additionalProperties: false, properties: {} },
  register(api: any) {
    createPythonPlugin(api, { script: new URL("./tools.py", import.meta.url) });
  },
};

export default plugin;
