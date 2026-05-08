/**
 * Withings plugin — pure TS-native implementation.
 * OAuth2 flow + health data fetching.
 */

import path from "node:path";
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

type PluginApi = { registerTool: (t: unknown) => void; pluginConfig?: Record<string, unknown> };

function fmt(data: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(data) }], details: {} }; }

const HOME = process.env.HOME ?? "/home/openclaw";

function buildConfig(pluginConfig?: Record<string, unknown>): WithingsConfig {
  return {
    clientId: (pluginConfig?.clientId as string) ?? process.env.WITHINGS_CLIENT_ID ?? "",
    clientSecret: (pluginConfig?.clientSecret as string) ?? process.env.WITHINGS_CLIENT_SECRET ?? "",
    redirectUri: (pluginConfig?.redirectUri as string) ?? process.env.WITHINGS_REDIRECT_URI ?? "http://localhost:18789/plugins/withings/oauth/callback",
    tokenFilePath: path.join(HOME, ".openclaw/withings_tokens.json"),
  };
}

const configSchema = { type: "object" as const, additionalProperties: false, properties: {
  clientId: { type: "string" as const, description: "Withings OAuth2 client ID" },
  clientSecret: { type: "string" as const, description: "Withings OAuth2 client secret" },
  redirectUri: { type: "string" as const, description: "OAuth2 redirect URI" },
} };

export function createEntry() {
  return {
    id: "withings", name: "Withings",
    description: "Fetch health data from Withings devices (weight, body composition, heart rate, sleep, activity)",
    contracts: { tools: ["withings_auth_url", "withings_auth_complete", "withings_auth_status", "withings_tokens", "withings_get_measurements", "withings_get_activity", "withings_get_heart", "withings_get_sleep"] },
    configSchema,
    register(api: PluginApi) {
      const cfg = () => buildConfig(api.pluginConfig);

      api.registerTool({ name: "withings_auth_url", label: "Withings Auth URL",
        description: "Generate a Withings OAuth2 authorization URL. Open this URL in a browser to link a Withings account.",
        parameters: Type.Object({}),
        async execute() {
          return fmt(handleAuthUrl(cfg()));
        },
      });

      api.registerTool({ name: "withings_auth_complete", label: "Withings Auth Complete",
        description: "Complete Withings OAuth2 flow by exchanging the authorization code for tokens.",
        parameters: Type.Object({ code: Type.String({ description: "The authorization code from the Withings redirect URL." }) }),
        async execute(_id: string, p: Record<string, unknown>) {
          return fmt(await handleAuthComplete(cfg(), { code: String(p.code ?? "") }));
        },
      });

      api.registerTool({ name: "withings_auth_status", label: "Withings Auth Status",
        description: "Check whether a Withings account is currently linked and whether the access token is valid.",
        parameters: Type.Object({}),
        async execute() {
          return fmt(handleAuthStatus(cfg()));
        },
      });

      api.registerTool({ name: "withings_get_measurements", label: "Withings Measurements",
        description: "Fetch body measurements from Withings: weight, body fat %, BMI, blood pressure, heart rate, and more.",
        parameters: Type.Object({
          days_back: Type.Optional(Type.Integer({ description: "How many days of history to fetch (default: 7)." })),
          meastypes: Type.Optional(Type.String({ description: "Optional comma-separated measurement type IDs (e.g. '1,6' for weight and fat ratio)." })),
        }),
        async execute(_id: string, p: Record<string, unknown>) {
          return fmt(await handleGetMeasurements(cfg(), { days_back: p.days_back as number | undefined, meastypes: p.meastypes as string | undefined }));
        },
      });

      api.registerTool({ name: "withings_get_activity", label: "Withings Activity",
        description: "Fetch daily activity summaries from Withings: steps, distance, calories, and active/light/moderate/intense minutes.",
        parameters: Type.Object({ days_back: Type.Optional(Type.Integer({ description: "How many days of history to fetch (default: 7)." })) }),
        async execute(_id: string, p: Record<string, unknown>) {
          return fmt(await handleGetActivity(cfg(), { days_back: p.days_back as number | undefined }));
        },
      });

      api.registerTool({ name: "withings_get_sleep", label: "Withings Sleep",
        description: "Fetch sleep summary data from Withings: total sleep time, REM, deep sleep, light sleep, sleep score, snoring, and wake count.",
        parameters: Type.Object({ days_back: Type.Optional(Type.Integer({ description: "How many days of history to fetch (default: 7)." })) }),
        async execute(_id: string, p: Record<string, unknown>) {
          return fmt(await handleGetSleep(cfg(), { days_back: p.days_back as number | undefined }));
        },
      });

      api.registerTool({ name: "withings_get_heart", label: "Withings Heart",
        description: "Fetch heart rate and ECG records from Withings, including AFib classification where available.",
        parameters: Type.Object({ days_back: Type.Optional(Type.Integer({ description: "How many days of history to fetch (default: 7)." })) }),
        async execute(_id: string, p: Record<string, unknown>) {
          return fmt(await handleGetHeart(cfg(), { days_back: p.days_back as number | undefined }));
        },
      });
    },
  };
}
