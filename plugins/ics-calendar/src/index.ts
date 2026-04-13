import { createPythonPlugin } from "@local/openclaw-python-framework";

const plugin = {
  id: "ics-calendar",
  name: "ICS Calendar",
  description: "Fetch upcoming events from a published ICS calendar feed",
  configSchema: { type: "object" as const, additionalProperties: false, properties: {} },
  register(api: any) {
    createPythonPlugin(api, { script: new URL("./tools.py", import.meta.url) });
  },
};

export default plugin;
