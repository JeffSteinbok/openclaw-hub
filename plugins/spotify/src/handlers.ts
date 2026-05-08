/**
 * Spotify handlers — pure business logic, no plugin SDK or typebox imports.
 */

import fs from "node:fs";
import https from "node:https";
import path from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
  tokenCachePath: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPOTIFY_API = "https://api.spotify.com/v1";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpPost(url: string, body: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: "POST", headers, timeout: 30_000 }, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => (data += c));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.write(body);
    req.end();
  });
}

function httpReq(method: string, url: string, token: string, body?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    if (body) headers["Content-Type"] = "application/json";
    const req = https.request(url, { method, headers, timeout: 30_000 }, (res) => {
      let data = "";
      res.on("data", (c: Buffer) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    if (body) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

interface TokenCache {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  token_type?: string;
}

function loadCache(cachePath: string): TokenCache {
  try { return JSON.parse(fs.readFileSync(cachePath, "utf8")); } catch { return {}; }
}

function saveCache(cachePath: string, t: TokenCache) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(t, null, 2));
}

async function getToken(config: SpotifyConfig): Promise<string> {
  const cache = loadCache(config.tokenCachePath);
  const now = Date.now() / 1000;
  if (cache.access_token && (cache.expires_at ?? 0) > now + 60) return cache.access_token;
  if (!cache.refresh_token) throw new Error("No Spotify refresh token. Re-authorize via Spotify OAuth.");
  const creds = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: cache.refresh_token }).toString();
  const res = await httpPost(TOKEN_URL, body, { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${creds}` });
  const data = JSON.parse(res);
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data).slice(0, 200)}`);
  cache.access_token = data.access_token;
  if (data.refresh_token) cache.refresh_token = data.refresh_token;
  cache.expires_at = now + (data.expires_in ?? 3600);
  saveCache(config.tokenCachePath, cache);
  return data.access_token;
}

async function api(method: string, apiPath: string, token: string, body?: unknown): Promise<unknown> {
  const res = await httpReq(method, `${SPOTIFY_API}${apiPath}`, token, body ? JSON.stringify(body) : undefined);
  if (res.status === 204 || !res.body.trim()) return null;
  if (res.status === 404) return null;
  if (res.status >= 400) throw new Error(`Spotify API ${res.status}: ${res.body.slice(0, 300)}`);
  return JSON.parse(res.body);
}

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export async function nowPlaying(config: SpotifyConfig): Promise<unknown> {
  const token = await getToken(config);
  const data = await api("GET", "/me/player", token) as Record<string, unknown> | null;
  if (!data?.item) return { playing: false };
  const item = data.item as Record<string, unknown>;
  const isEpisode = item.type === "episode";
  const result: Record<string, unknown> = {
    playing: data.is_playing, item_type: item.type, track: item.name,
    track_uri: item.uri, progress_ms: data.progress_ms, duration_ms: item.duration_ms,
  };
  if (isEpisode) {
    const show = (item.show ?? {}) as Record<string, string>;
    result.artist = show.publisher || show.name || "";
    result.album = show.name || "";
    result.show = show.name;
  } else {
    result.artist = ((item.artists ?? []) as Array<{ name: string }>).map((a) => a.name).join(", ");
    result.album = ((item.album as Record<string, string> | undefined)?.name) ?? "";
  }
  const device = data.device as Record<string, string> | undefined;
  if (device) result.device = device.name;
  return result;
}

export async function play(config: SpotifyConfig, params: { uri?: string; device_id?: string }): Promise<unknown> {
  const token = await getToken(config);
  const qs = params.device_id ? `?device_id=${params.device_id}` : "";
  let body: Record<string, unknown> | undefined;
  if (params.uri) {
    if (params.uri.includes(":track:")) body = { uris: [params.uri] };
    else body = { context_uri: params.uri };
  }
  await api("PUT", `/me/player/play${qs}`, token, body ?? {});
  return { ok: true, playing: params.uri ?? true };
}

export async function pause(config: SpotifyConfig, params: { device_id?: string }): Promise<unknown> {
  const token = await getToken(config);
  const qs = params.device_id ? `?device_id=${params.device_id}` : "";
  await api("PUT", `/me/player/pause${qs}`, token, {});
  return { ok: true, paused: true };
}

export async function next(config: SpotifyConfig, params: { device_id?: string }): Promise<unknown> {
  const token = await getToken(config);
  const qs = params.device_id ? `?device_id=${params.device_id}` : "";
  await api("POST", `/me/player/next${qs}`, token, {});
  return { ok: true };
}

export async function previous(config: SpotifyConfig, params: { device_id?: string }): Promise<unknown> {
  const token = await getToken(config);
  const qs = params.device_id ? `?device_id=${params.device_id}` : "";
  await api("POST", `/me/player/previous${qs}`, token, {});
  return { ok: true };
}

export async function search(config: SpotifyConfig, params: { query: string; type?: string; limit?: number }): Promise<unknown> {
  const token = await getToken(config);
  const q = encodeURIComponent(params.query);
  const type = params.type ?? "track";
  const limit = Math.min(params.limit ?? 10, 50);
  const data = await api("GET", `/search?q=${q}&type=${type}&limit=${limit}`, token) as Record<string, Record<string, unknown[]>>;
  const items = data?.[`${type}s`]?.items ?? [];
  return { type, count: items.length, items };
}

export async function getDevices(config: SpotifyConfig): Promise<unknown> {
  const token = await getToken(config);
  const data = await api("GET", "/me/player/devices", token) as { devices: Array<Record<string, unknown>> };
  return { devices: data?.devices ?? [] };
}

export async function getPlaylists(config: SpotifyConfig, params: { limit?: number }): Promise<unknown> {
  const token = await getToken(config);
  const limit = Math.min(params.limit ?? 20, 50);
  const data = await api("GET", `/me/playlists?limit=${limit}`, token) as Record<string, unknown>;
  const playlists = ((data?.items ?? []) as Array<Record<string, unknown>>).map((pl) => ({
    id: pl.id, name: pl.name, tracks: (pl.tracks as Record<string, number> | undefined)?.total ?? 0, uri: pl.uri,
  }));
  return { playlists, count: playlists.length };
}

export async function addToPlaylist(config: SpotifyConfig, params: { playlist_id: string; track_uri: string }): Promise<unknown> {
  const playlistId = params.playlist_id.trim();
  const trackUri = params.track_uri.trim();
  if (!playlistId || !trackUri) return { error: "playlist_id and track_uri are required" };
  const token = await getToken(config);
  await api("POST", `/playlists/${playlistId}/tracks`, token, { uris: [trackUri] });
  return { ok: true, playlist_id: playlistId, track_uri: trackUri };
}
