/**
 * Withings plugin — pure TS-native implementation.
 * OAuth2 flow + health data fetching.
 */

import path from "node:path";
import { definePlugin } from "carapace-plugin-sdk";
import { Type } from "@sinclair/typebox";
import {
  handleAuthUrl,
  handleAuthComplete,
  handleAuthStatus,
  handleGetMeasurements,
  handleGetActivity,
  handleGetSleep,
  handleGetHeart,
  type WithingsConfig,
} from "./handlers.js";

const HOME = process.env.HOME ?? "/home/openclaw";

export const createEntry = definePlugin({
  id: "withings",
  name: "Withings",
  description: "Fetch health data from Withings devices (weight, body composition, heart rate, sleep, activity)",
  contracts: { tools: ["withings_auth_url", "withings_auth_complete", "withings_auth_status", "withings_tokens", "withings_get_measurements", "withings_get_activity", "withings_get_heart", "withings_get_sleep"] },

  configSchema: Type.Object({
    clientId: Type.Optional(Type.String({ description: "Withings OAuth2 client ID" })),
    clientSecret: Type.Optional(Type.String({ description: "Withings OAuth2 client secret" })),
    redirectUri: Type.Optional(Type.String({ description: "OAuth2 redirect URI" })),
    tokenFilePath: Type.Optional(Type.String({ description: "Path where Withings OAuth tokens are stored" })),
  }),

  tools: (tool) => [
    tool({
      name: "withings_auth_url",
      label: "Withings Auth URL",
      description: "Generate a Withings OAuth2 authorization URL. Open this URL in a browser to link a Withings account.",
      parameters: Type.Object({}),
      async execute(_params, config) {
        const pluginConfig: WithingsConfig = {
          clientId: config.clientId?.trim() || process.env.WITHINGS_CLIENT_ID || "",
          clientSecret: config.clientSecret?.trim() || process.env.WITHINGS_CLIENT_SECRET || "",
          redirectUri: config.redirectUri?.trim() || process.env.WITHINGS_REDIRECT_URI || "http://localhost:18789/plugins/withings/oauth/callback",
          tokenFilePath: config.tokenFilePath?.trim() || path.join(HOME, ".openclaw/withings_tokens.json"),
        };
        return handleAuthUrl(pluginConfig);
      },
    }),

    tool({
      name: "withings_auth_complete",
      label: "Withings Auth Complete",
      description: "Complete Withings OAuth2 flow by exchanging the authorization code for tokens.",
      parameters: Type.Object({ code: Type.String({ description: "The authorization code from the Withings redirect URL." }) }),
      async execute({ code }, config) {
        const pluginConfig: WithingsConfig = {
          clientId: config.clientId?.trim() || process.env.WITHINGS_CLIENT_ID || "",
          clientSecret: config.clientSecret?.trim() || process.env.WITHINGS_CLIENT_SECRET || "",
          redirectUri: config.redirectUri?.trim() || process.env.WITHINGS_REDIRECT_URI || "http://localhost:18789/plugins/withings/oauth/callback",
          tokenFilePath: config.tokenFilePath?.trim() || path.join(HOME, ".openclaw/withings_tokens.json"),
        };
        return await handleAuthComplete(pluginConfig, { code });
      },
    }),

    tool({
      name: "withings_auth_status",
      label: "Withings Auth Status",
      description: "Check whether a Withings account is currently linked and whether the access token is valid.",
      parameters: Type.Object({}),
      async execute(_params, config) {
        const pluginConfig: WithingsConfig = {
          clientId: config.clientId?.trim() || process.env.WITHINGS_CLIENT_ID || "",
          clientSecret: config.clientSecret?.trim() || process.env.WITHINGS_CLIENT_SECRET || "",
          redirectUri: config.redirectUri?.trim() || process.env.WITHINGS_REDIRECT_URI || "http://localhost:18789/plugins/withings/oauth/callback",
          tokenFilePath: config.tokenFilePath?.trim() || path.join(HOME, ".openclaw/withings_tokens.json"),
        };
        return handleAuthStatus(pluginConfig);
      },
    }),

    tool({
      name: "withings_get_measurements",
      label: "Withings Measurements",
      description: "Fetch body measurements from Withings: weight, body fat %, BMI, blood pressure, heart rate, and more.",
      parameters: Type.Object({
        days_back: Type.Optional(Type.Integer({ description: "How many days of history to fetch (default: 7)." })),
        meastypes: Type.Optional(Type.String({ description: "Optional comma-separated measurement type IDs (e.g. '1,6' for weight and fat ratio)." })),
      }),
      async execute({ days_back, meastypes }, config) {
        const pluginConfig: WithingsConfig = {
          clientId: config.clientId?.trim() || process.env.WITHINGS_CLIENT_ID || "",
          clientSecret: config.clientSecret?.trim() || process.env.WITHINGS_CLIENT_SECRET || "",
          redirectUri: config.redirectUri?.trim() || process.env.WITHINGS_REDIRECT_URI || "http://localhost:18789/plugins/withings/oauth/callback",
          tokenFilePath: config.tokenFilePath?.trim() || path.join(HOME, ".openclaw/withings_tokens.json"),
        };
        return await handleGetMeasurements(pluginConfig, { days_back, meastypes });
      },
    }),

    tool({
      name: "withings_get_activity",
      label: "Withings Activity",
      description: "Fetch daily activity summaries from Withings: steps, distance, calories, and active/light/moderate/intense minutes.",
      parameters: Type.Object({ days_back: Type.Optional(Type.Integer({ description: "How many days of history to fetch (default: 7)." })) }),
      async execute({ days_back }, config) {
        const pluginConfig: WithingsConfig = {
          clientId: config.clientId?.trim() || process.env.WITHINGS_CLIENT_ID || "",
          clientSecret: config.clientSecret?.trim() || process.env.WITHINGS_CLIENT_SECRET || "",
          redirectUri: config.redirectUri?.trim() || process.env.WITHINGS_REDIRECT_URI || "http://localhost:18789/plugins/withings/oauth/callback",
          tokenFilePath: config.tokenFilePath?.trim() || path.join(HOME, ".openclaw/withings_tokens.json"),
        };
        return await handleGetActivity(pluginConfig, { days_back });
      },
    }),

    tool({
      name: "withings_get_sleep",
      label: "Withings Sleep",
      description: "Fetch sleep summary data from Withings: total sleep time, REM, deep sleep, light sleep, sleep score, snoring, and wake count.",
      parameters: Type.Object({ days_back: Type.Optional(Type.Integer({ description: "How many days of history to fetch (default: 7)." })) }),
      async execute({ days_back }, config) {
        const pluginConfig: WithingsConfig = {
          clientId: config.clientId?.trim() || process.env.WITHINGS_CLIENT_ID || "",
          clientSecret: config.clientSecret?.trim() || process.env.WITHINGS_CLIENT_SECRET || "",
          redirectUri: config.redirectUri?.trim() || process.env.WITHINGS_REDIRECT_URI || "http://localhost:18789/plugins/withings/oauth/callback",
          tokenFilePath: config.tokenFilePath?.trim() || path.join(HOME, ".openclaw/withings_tokens.json"),
        };
        return await handleGetSleep(pluginConfig, { days_back });
      },
    }),

    tool({
      name: "withings_get_heart",
      label: "Withings Heart",
      description: "Fetch heart rate and ECG records from Withings, including AFib classification where available.",
      parameters: Type.Object({ days_back: Type.Optional(Type.Integer({ description: "How many days of history to fetch (default: 7)." })) }),
      async execute({ days_back }, config) {
        const pluginConfig: WithingsConfig = {
          clientId: config.clientId?.trim() || process.env.WITHINGS_CLIENT_ID || "",
          clientSecret: config.clientSecret?.trim() || process.env.WITHINGS_CLIENT_SECRET || "",
          redirectUri: config.redirectUri?.trim() || process.env.WITHINGS_REDIRECT_URI || "http://localhost:18789/plugins/withings/oauth/callback",
          tokenFilePath: config.tokenFilePath?.trim() || path.join(HOME, ".openclaw/withings_tokens.json"),
        };
        return await handleGetHeart(pluginConfig, { days_back });
      },
    }),
  ],
});
