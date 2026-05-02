import { createPythonPlugin } from "@local/openclaw-python-framework";

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    clientId: { type: "string" as const, description: "Spotify app client ID" },
    clientSecret: { type: "string" as const, description: "Spotify app client secret" },
    redirectUri: {
      type: "string" as const,
      description: "Spotify OAuth redirect URI",
      default: "http://127.0.0.1:8888/callback",
    },
  },
};

const plugin = {
  id: "spotify",
  name: "Spotify",
  description: "Control Spotify playback, search music, and manage playlists",
  configSchema,
  register(api: any) {
    createPythonPlugin(api, { script: new URL("./tools.py", import.meta.url) });
  },
};

export default plugin;
