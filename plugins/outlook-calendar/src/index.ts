import { createPythonPlugin } from "@local/openclaw-python-framework";

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    clientId: {
      type: "string" as const,
      description: "Microsoft Graph OAuth2 client ID",
    },
    clientSecret: {
      type: "string" as const,
      description: "Microsoft Graph OAuth2 client secret",
    },
    refreshToken: {
      type: "string" as const,
      description: "Microsoft Graph OAuth2 refresh token",
    },
    personalCalendarNames: {
      type: "array" as const,
      description: "Optional additional Outlook calendar names to try before the built-in personal defaults",
      items: {
        type: "string" as const,
      },
    },
    familyCalendarNames: {
      type: "array" as const,
      description: "Optional additional Outlook calendar names to try before the built-in family defaults",
      items: {
        type: "string" as const,
      },
    },
  },
};

const plugin = {
  id: "outlook-calendar",
  name: "Outlook Calendar",
  description: "Fetch upcoming events from Outlook personal and family calendars",
  configSchema,
  register(api: any) {
    const config = api.pluginConfig ?? {};
    if (typeof config.clientId === "string" && config.clientId.trim()) {
      process.env.OUTLOOK_CLIENT_ID = config.clientId.trim();
    }
    if (typeof config.clientSecret === "string" && config.clientSecret.trim()) {
      process.env.OUTLOOK_CLIENT_SECRET = config.clientSecret.trim();
    }
    if (typeof config.refreshToken === "string" && config.refreshToken.trim()) {
      process.env.OUTLOOK_REFRESH_TOKEN = config.refreshToken.trim();
    }
    if (Array.isArray(config.personalCalendarNames) && config.personalCalendarNames.length > 0) {
      process.env.OUTLOOK_PERSONAL_CALENDAR_NAMES = config.personalCalendarNames
        .filter((value: unknown): value is string => typeof value === "string")
        .map((value: string) => value.trim())
        .filter(Boolean)
        .join(",");
    }
    if (Array.isArray(config.familyCalendarNames) && config.familyCalendarNames.length > 0) {
      process.env.OUTLOOK_FAMILY_CALENDAR_NAMES = config.familyCalendarNames
        .filter((value: unknown): value is string => typeof value === "string")
        .map((value: string) => value.trim())
        .filter(Boolean)
        .join(",");
    }
    createPythonPlugin(api, { script: new URL("./tools.py", import.meta.url) });
  },
};

export default plugin;
