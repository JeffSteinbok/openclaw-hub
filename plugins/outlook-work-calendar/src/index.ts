import { createPythonPlugin } from "@local/openclaw-python-framework";

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    url: {
      type: "string" as const,
      description: "Published Outlook work calendar base URL",
    },
    folderId: {
      type: "string" as const,
      description: "EWS folder identifier for the published calendar",
    },
  },
};

const plugin = {
  id: "outlook-work-calendar",
  name: "Outlook Work Calendar",
  description: "Fetch upcoming events from a published Outlook work calendar",
  configSchema,
  register(api: any) {
    const config = api.pluginConfig ?? {};
    if (typeof config.url === "string" && config.url.trim()) {
      process.env.OUTLOOK_WORK_CALENDAR_URL = config.url.trim();
    }
    if (typeof config.folderId === "string" && config.folderId.trim()) {
      process.env.OUTLOOK_WORK_FOLDER_ID = config.folderId.trim();
    }
    createPythonPlugin(api, { script: new URL("./tools.py", import.meta.url) });
  },
};

export default plugin;
