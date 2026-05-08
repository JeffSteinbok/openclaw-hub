/**
 * Spotify plugin — thin shim delegating to handlers.ts.
 */

import path from "node:path";
import { Type } from "@sinclair/typebox";
import {
  type SpotifyConfig,
  nowPlaying, play, pause, next, previous, search, getDevices, getPlaylists, addToPlaylist,
} from "./handlers.js";

type PluginApi = { registerTool: (t: unknown) => void; pluginConfig?: Record<string, unknown> };

function formatResult(data: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(data) }], details: {} }; }

const configSchema = { type: "object" as const, additionalProperties: false, properties: {
  clientId: { type: "string" as const, description: "Spotify app client ID" },
  clientSecret: { type: "string" as const, description: "Spotify app client secret" },
  redirectUri: { type: "string" as const, description: "OAuth2 redirect URI" },
}};

function buildConfig(pluginConfig?: Record<string, unknown>): SpotifyConfig {
  const HOME = process.env.HOME ?? "/home/openclaw";
  return {
    clientId: (pluginConfig?.clientId as string) ?? process.env.SPOTIFY_CLIENT_ID ?? "",
    clientSecret: (pluginConfig?.clientSecret as string) ?? process.env.SPOTIFY_CLIENT_SECRET ?? "",
    tokenCachePath: path.join(HOME, ".openclaw/.spotify_token_cache"),
  };
}

export function createEntry() {
  return {
    id: "spotify", name: "Spotify",
    description: "Control Spotify playback, search music, and manage playlists",
    contracts: { tools: ["spotify_now_playing", "spotify_play", "spotify_pause", "spotify_next", "spotify_previous", "spotify_search", "spotify_get_devices", "spotify_get_playlists", "spotify_add_to_playlist"] },
    configSchema,
    register(api_: PluginApi) {
      const cfg = () => buildConfig(api_.pluginConfig);

      api_.registerTool({ name: "spotify_now_playing", label: "Spotify Now Playing",
        description: "Get the currently playing item on Spotify, including playback details.",
        parameters: Type.Object({}),
        async execute() {
          try { return formatResult(await nowPlaying(cfg())); }
          catch (e) { return formatResult({ error: (e as Error).message }); }
        },
      });

      api_.registerTool({ name: "spotify_play", label: "Spotify Play",
        description: "Start or resume Spotify playback. Optionally provide a Spotify URI to play something specific.",
        parameters: Type.Object({
          uri: Type.Optional(Type.String({ description: "Spotify URI to play (e.g. spotify:track:..., spotify:album:..., spotify:playlist:...). Omit to resume current playback." })),
          device_id: Type.Optional(Type.String({ description: "Target device ID. Omit to use the active device." })),
        }),
        async execute(_id: string, p: Record<string, unknown>) {
          try { return formatResult(await play(cfg(), { uri: p.uri as string | undefined, device_id: p.device_id as string | undefined })); }
          catch (e) { return formatResult({ error: (e as Error).message }); }
        },
      });

      api_.registerTool({ name: "spotify_pause", label: "Spotify Pause",
        description: "Pause Spotify playback.",
        parameters: Type.Object({ device_id: Type.Optional(Type.String({ description: "Target device ID. Omit to use the active device." })) }),
        async execute(_id: string, p: Record<string, unknown>) {
          try { return formatResult(await pause(cfg(), { device_id: p.device_id as string | undefined })); }
          catch (e) { return formatResult({ error: (e as Error).message }); }
        },
      });

      api_.registerTool({ name: "spotify_next", label: "Spotify Next",
        description: "Skip to the next track in the Spotify queue.",
        parameters: Type.Object({ device_id: Type.Optional(Type.String({ description: "Target device ID. Omit to use the active device." })) }),
        async execute(_id: string, p: Record<string, unknown>) {
          try { return formatResult(await next(cfg(), { device_id: p.device_id as string | undefined })); }
          catch (e) { return formatResult({ error: (e as Error).message }); }
        },
      });

      api_.registerTool({ name: "spotify_previous", label: "Spotify Previous",
        description: "Go back to the previous track on Spotify.",
        parameters: Type.Object({ device_id: Type.Optional(Type.String({ description: "Target device ID. Omit to use the active device." })) }),
        async execute(_id: string, p: Record<string, unknown>) {
          try { return formatResult(await previous(cfg(), { device_id: p.device_id as string | undefined })); }
          catch (e) { return formatResult({ error: (e as Error).message }); }
        },
      });

      api_.registerTool({ name: "spotify_search", label: "Spotify Search",
        description: "Search Spotify for tracks, albums, artists, or playlists.",
        parameters: Type.Object({
          query: Type.String({ description: "Search query (e.g. 'Daft Punk Digital Love', 'chill jazz playlist')." }),
          type: Type.Optional(Type.Union([Type.Literal("track"), Type.Literal("album"), Type.Literal("artist"), Type.Literal("playlist")], { description: "Type of result to search for (default: track)." })),
          limit: Type.Optional(Type.Integer({ description: "Max number of results to return (default: 10, max: 50)." })),
        }),
        async execute(_id: string, p: Record<string, unknown>) {
          try { return formatResult(await search(cfg(), { query: String(p.query ?? ""), type: p.type as string | undefined, limit: p.limit as number | undefined })); }
          catch (e) { return formatResult({ error: (e as Error).message }); }
        },
      });

      api_.registerTool({ name: "spotify_get_playlists", label: "Spotify Get Playlists",
        description: "List the current user's Spotify playlists with IDs and track counts.",
        parameters: Type.Object({ limit: Type.Optional(Type.Integer({ description: "Max number of playlists to return (default: 20, max: 50)." })) }),
        async execute(_id: string, p: Record<string, unknown>) {
          try { return formatResult(await getPlaylists(cfg(), { limit: p.limit as number | undefined })); }
          catch (e) { return formatResult({ error: (e as Error).message }); }
        },
      });

      api_.registerTool({ name: "spotify_get_devices", label: "Spotify Get Devices",
        description: "List available Spotify Connect devices (speakers, phones, computers) with their IDs and active status.",
        parameters: Type.Object({}),
        async execute() {
          try { return formatResult(await getDevices(cfg())); }
          catch (e) { return formatResult({ error: (e as Error).message }); }
        },
      });

      api_.registerTool({ name: "spotify_add_to_playlist", label: "Spotify Add to Playlist",
        description: "Add a track to a Spotify playlist by playlist ID and track URI.",
        parameters: Type.Object({
          playlist_id: Type.String({ description: "Spotify playlist ID (from spotify_get_playlists)." }),
          track_uri: Type.String({ description: "Spotify track URI to add (e.g. spotify:track:...)." }),
        }),
        async execute(_id: string, p: Record<string, unknown>) {
          try { return formatResult(await addToPlaylist(cfg(), { playlist_id: String(p.playlist_id ?? ""), track_uri: String(p.track_uri ?? "") })); }
          catch (e) { return formatResult({ error: (e as Error).message }); }
        },
      });
    },
  };
}
