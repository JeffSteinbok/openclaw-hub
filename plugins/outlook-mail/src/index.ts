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
  },
};

const plugin = {
  id: "outlook-mail",
  name: "Outlook Mail",
  description: "Search and read messages from Outlook inboxes",
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
    createPythonPlugin(api, { script: new URL("./tools.py", import.meta.url) });
  },
};

export default plugin;
