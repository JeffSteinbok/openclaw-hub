import { createPythonPlugin } from "@local/openclaw-python-framework";

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    clientId: {
      type: "string",
      description: "Withings OAuth2 App Client ID",
    },
    clientSecret: {
      type: "string",
      description: "Withings OAuth2 App Client Secret",
    },
    redirectUri: {
      type: "string",
      description: "OAuth redirect URI registered with the Withings app",
    },
  },
};

const plugin = {
  id: "withings",
  name: "Withings",
  description: "Fetch health data from Withings devices (weight, body composition, heart rate, sleep, activity)",
  configSchema,
  register(api: any) {
    const config = api.pluginConfig ?? {};
    if (typeof config.clientId === "string" && config.clientId.trim()) {
      process.env.WITHINGS_CLIENT_ID = config.clientId.trim();
    }
    if (typeof config.clientSecret === "string" && config.clientSecret.trim()) {
      process.env.WITHINGS_CLIENT_SECRET = config.clientSecret.trim();
    }
    if (typeof config.redirectUri === "string" && config.redirectUri.trim()) {
      process.env.WITHINGS_REDIRECT_URI = config.redirectUri.trim();
    }

    createPythonPlugin(api, { script: new URL("./tools.py", import.meta.url) });
  },
};

export default plugin;
