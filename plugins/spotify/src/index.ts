import { createPythonPlugin } from "@local/openclaw-python-framework";

const plugin = {
  id: "spotify",
  name: "Spotify",
  description: "Control Spotify playback, search music, and manage playlists",
  configSchema: { type: "object" as const, additionalProperties: false, properties: {} },
  register(api: any) {
    createPythonPlugin(api, { script: new URL("./tools.py", import.meta.url) });
  },
};

export default plugin;
