/**
 * Spotify plugin — thin shim delegating to handlers.ts.
 */

import path from "node:path";
import { definePlugin } from "carapace-plugin-sdk";
import { Type } from "@sinclair/typebox";
import {
  type SpotifyConfig,
  nowPlaying, play, pause, next, previous, search, getDevices, getPlaylists, addToPlaylist,
} from "./handlers.js";

const HOME = process.env.HOME ?? "/home/openclaw";

export const createEntry = definePlugin({
  id: "spotify",
  name: "Spotify",
  description: "Control Spotify playback, search music, and manage playlists",
  contracts: { tools: ["spotify_now_playing", "spotify_play", "spotify_pause", "spotify_next", "spotify_previous", "spotify_search", "spotify_get_devices", "spotify_get_playlists", "spotify_add_to_playlist"] },

  configSchema: Type.Object({
    clientId: Type.Optional(Type.String({ description: "Spotify app client ID" })),
    clientSecret: Type.Optional(Type.String({ description: "Spotify app client secret" })),
    redirectUri: Type.Optional(Type.String({ description: "OAuth2 redirect URI" })),
    tokenCachePath: Type.Optional(Type.String({ description: "Path where the Spotify token cache is stored" })),
  }),

  tools: (tool) => [
    tool({
      name: "spotify_now_playing",
      label: "Spotify Now Playing",
      description: "Get the currently playing item on Spotify, including playback details.",
      parameters: Type.Object({}),
      async execute(_params, config) {
        try {
          const pluginConfig: SpotifyConfig = {
            clientId: config.clientId?.trim() || process.env.SPOTIFY_CLIENT_ID || "",
            clientSecret: config.clientSecret?.trim() || process.env.SPOTIFY_CLIENT_SECRET || "",
            tokenCachePath: config.tokenCachePath?.trim() || path.join(HOME, ".openclaw/.spotify_token_cache"),
          };
          return await nowPlaying(pluginConfig);
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "spotify_play",
      label: "Spotify Play",
      description: "Start or resume Spotify playback. Optionally provide a Spotify URI to play something specific.",
      parameters: Type.Object({
        uri: Type.Optional(Type.String({ description: "Spotify URI to play (e.g. spotify:track:..., spotify:album:..., spotify:playlist:...). Omit to resume current playback." })),
        device_id: Type.Optional(Type.String({ description: "Target device ID. Omit to use the active device." })),
      }),
      async execute({ uri, device_id }, config) {
        try {
          const pluginConfig: SpotifyConfig = {
            clientId: config.clientId?.trim() || process.env.SPOTIFY_CLIENT_ID || "",
            clientSecret: config.clientSecret?.trim() || process.env.SPOTIFY_CLIENT_SECRET || "",
            tokenCachePath: config.tokenCachePath?.trim() || path.join(HOME, ".openclaw/.spotify_token_cache"),
          };
          return await play(pluginConfig, { uri, device_id });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "spotify_pause",
      label: "Spotify Pause",
      description: "Pause Spotify playback.",
      parameters: Type.Object({ device_id: Type.Optional(Type.String({ description: "Target device ID. Omit to use the active device." })) }),
      async execute({ device_id }, config) {
        try {
          const pluginConfig: SpotifyConfig = {
            clientId: config.clientId?.trim() || process.env.SPOTIFY_CLIENT_ID || "",
            clientSecret: config.clientSecret?.trim() || process.env.SPOTIFY_CLIENT_SECRET || "",
            tokenCachePath: config.tokenCachePath?.trim() || path.join(HOME, ".openclaw/.spotify_token_cache"),
          };
          return await pause(pluginConfig, { device_id });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "spotify_next",
      label: "Spotify Next",
      description: "Skip to the next track in the Spotify queue.",
      parameters: Type.Object({ device_id: Type.Optional(Type.String({ description: "Target device ID. Omit to use the active device." })) }),
      async execute({ device_id }, config) {
        try {
          const pluginConfig: SpotifyConfig = {
            clientId: config.clientId?.trim() || process.env.SPOTIFY_CLIENT_ID || "",
            clientSecret: config.clientSecret?.trim() || process.env.SPOTIFY_CLIENT_SECRET || "",
            tokenCachePath: config.tokenCachePath?.trim() || path.join(HOME, ".openclaw/.spotify_token_cache"),
          };
          return await next(pluginConfig, { device_id });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "spotify_previous",
      label: "Spotify Previous",
      description: "Go back to the previous track on Spotify.",
      parameters: Type.Object({ device_id: Type.Optional(Type.String({ description: "Target device ID. Omit to use the active device." })) }),
      async execute({ device_id }, config) {
        try {
          const pluginConfig: SpotifyConfig = {
            clientId: config.clientId?.trim() || process.env.SPOTIFY_CLIENT_ID || "",
            clientSecret: config.clientSecret?.trim() || process.env.SPOTIFY_CLIENT_SECRET || "",
            tokenCachePath: config.tokenCachePath?.trim() || path.join(HOME, ".openclaw/.spotify_token_cache"),
          };
          return await previous(pluginConfig, { device_id });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "spotify_search",
      label: "Spotify Search",
      description: "Search Spotify for tracks, albums, artists, or playlists.",
      parameters: Type.Object({
        query: Type.String({ description: "Search query (e.g. 'Daft Punk Digital Love', 'chill jazz playlist')." }),
        type: Type.Optional(Type.Union([Type.Literal("track"), Type.Literal("album"), Type.Literal("artist"), Type.Literal("playlist")], { description: "Type of result to search for (default: track)." })),
        limit: Type.Optional(Type.Integer({ description: "Max number of results to return (default: 10, max: 50)." })),
      }),
      async execute({ query, type, limit }, config) {
        try {
          const pluginConfig: SpotifyConfig = {
            clientId: config.clientId?.trim() || process.env.SPOTIFY_CLIENT_ID || "",
            clientSecret: config.clientSecret?.trim() || process.env.SPOTIFY_CLIENT_SECRET || "",
            tokenCachePath: config.tokenCachePath?.trim() || path.join(HOME, ".openclaw/.spotify_token_cache"),
          };
          return await search(pluginConfig, { query, type, limit });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "spotify_get_playlists",
      label: "Spotify Get Playlists",
      description: "List the current user's Spotify playlists with IDs and track counts.",
      parameters: Type.Object({ limit: Type.Optional(Type.Integer({ description: "Max number of playlists to return (default: 20, max: 50)." })) }),
      async execute({ limit }, config) {
        try {
          const pluginConfig: SpotifyConfig = {
            clientId: config.clientId?.trim() || process.env.SPOTIFY_CLIENT_ID || "",
            clientSecret: config.clientSecret?.trim() || process.env.SPOTIFY_CLIENT_SECRET || "",
            tokenCachePath: config.tokenCachePath?.trim() || path.join(HOME, ".openclaw/.spotify_token_cache"),
          };
          return await getPlaylists(pluginConfig, { limit });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "spotify_get_devices",
      label: "Spotify Get Devices",
      description: "List available Spotify Connect devices (speakers, phones, computers) with their IDs and active status.",
      parameters: Type.Object({}),
      async execute(_params, config) {
        try {
          const pluginConfig: SpotifyConfig = {
            clientId: config.clientId?.trim() || process.env.SPOTIFY_CLIENT_ID || "",
            clientSecret: config.clientSecret?.trim() || process.env.SPOTIFY_CLIENT_SECRET || "",
            tokenCachePath: config.tokenCachePath?.trim() || path.join(HOME, ".openclaw/.spotify_token_cache"),
          };
          return await getDevices(pluginConfig);
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),

    tool({
      name: "spotify_add_to_playlist",
      label: "Spotify Add to Playlist",
      description: "Add a track to a Spotify playlist by playlist ID and track URI.",
      parameters: Type.Object({
        playlist_id: Type.String({ description: "Spotify playlist ID (from spotify_get_playlists)." }),
        track_uri: Type.String({ description: "Spotify track URI to add (e.g. spotify:track:...)." }),
      }),
      async execute({ playlist_id, track_uri }, config) {
        try {
          const pluginConfig: SpotifyConfig = {
            clientId: config.clientId?.trim() || process.env.SPOTIFY_CLIENT_ID || "",
            clientSecret: config.clientSecret?.trim() || process.env.SPOTIFY_CLIENT_SECRET || "",
            tokenCachePath: config.tokenCachePath?.trim() || path.join(HOME, ".openclaw/.spotify_token_cache"),
          };
          return await addToPlaylist(pluginConfig, { playlist_id, track_uri });
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),
  ],
});
