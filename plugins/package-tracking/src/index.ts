import { createPythonPlugin } from "@local/openclaw-python-framework";

const plugin = {
  id: "package-tracking",
  name: "Package Tracking",
  description: "Track packages from UPS, FedEx, USPS, and Amazon",
  configSchema: { type: "object" as const, additionalProperties: false, properties: {} },
  register(api: any) {
    createPythonPlugin(api, { script: new URL("./tools.py", import.meta.url) });
  },
};

export default plugin;
