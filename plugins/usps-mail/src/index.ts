import { createPythonPlugin } from "@local/openclaw-python-framework";

const plugin = {
  id: "usps-mail",
  name: "USPS Mail Analyzer",
  description:
    "Analyze USPS Informed Delivery digest emails: parse, vision-classify, apply rules, write memory, send notifications",
  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {},
  },
  register(api: any) {
    createPythonPlugin(api, { script: new URL("./tools.py", import.meta.url) });
  },
};

export default plugin;
