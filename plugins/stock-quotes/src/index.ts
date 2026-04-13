import { createPythonPlugin } from "@local/openclaw-python-framework";

const plugin = {
  id: "stock-quotes",
  name: "Stock Quotes",
  description: "Fetch current stock, ETF, and mutual fund quotes",
  configSchema: { type: "object" as const, additionalProperties: false, properties: {} },
  register(api: any) {
    createPythonPlugin(api, { script: new URL("./tools.py", import.meta.url) });
  },
};

export default plugin;
