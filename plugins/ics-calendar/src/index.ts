import { createPythonPlugin } from "@local/openclaw-python-framework";

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    calendars: {
      type: "array" as const,
      description: "Configured ICS feeds available by id",
      items: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          id: {
            type: "string" as const,
            description: "Stable calendar identifier used by tool calls",
          },
          label: {
            type: "string" as const,
            description: "Friendly display name used in output",
          },
          url: {
            type: "string" as const,
            description: "Published ICS feed URL",
          },
        },
        required: ["id", "url"],
      },
    },
  },
};

const plugin = {
  id: "ics-calendar",
  name: "ICS Calendar",
  description: "Fetch upcoming events from a published ICS calendar feed",
  configSchema,
  register(api: any) {
    createPythonPlugin(api, { script: new URL("./tools.py", import.meta.url) });
  },
};

export default plugin;
