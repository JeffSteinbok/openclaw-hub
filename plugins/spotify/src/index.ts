/**
 * Spotify plugin — pure TS-native implementation.
 * Uses Spotify Web API directly via Node https. Token cache compatible with spotipy.
 */

import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { Type } from "@sinclair/typebox";

type PluginApi = { registerTool: (t: unknown) => void; pluginConfig?: Record<string, unknown> };

const HOME = process.env.HOME??"/home/openclaw";
const TOKEN_CACHE = path.join(HOME, ".openclaw/.spotify_token_cache");
const SPOTIFY_API = "https://api.spotify.com/v1";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpPost(url: string, body: string, headers: Record<string,string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {method:"POST",headers,timeout:30_000}, res => {
      let data=""; res.on("data",(c:Buffer)=>data+=c); res.on("end",()=>resolve(data));
    });
    req.on("error",reject); req.on("timeout",()=>{req.destroy();reject(new Error("timeout"));}); req.write(body); req.end();
  });
}

function httpReq(method: string, url: string, token: string, body?: string): Promise<{status:number;body:string}> {
  return new Promise((resolve, reject) => {
    const headers: Record<string,string> = {Authorization:`Bearer ${token}`,Accept:"application/json"};
    if (body) headers["Content-Type"] = "application/json";
    const req = https.request(url, {method,headers,timeout:30_000}, res => {
      let data=""; res.on("data",(c:Buffer)=>data+=c); res.on("end",()=>resolve({status:res.statusCode??0,body:data}));
    });
    req.on("error",reject); req.on("timeout",()=>{req.destroy();reject(new Error("timeout"));}); 
    if (body) req.write(body); req.end();
  });
}

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

interface TokenCache { access_token?: string; refresh_token?: string; expires_at?: number; token_type?: string }

function loadCache(): TokenCache {
  try { return JSON.parse(fs.readFileSync(TOKEN_CACHE,"utf8")); } catch { return {}; }
}
function saveCache(t: TokenCache) { fs.writeFileSync(TOKEN_CACHE, JSON.stringify(t,null,2)); }

async function getToken(clientId: string, clientSecret: string): Promise<string> {
  const cache = loadCache();
  const now = Date.now()/1000;
  if (cache.access_token && (cache.expires_at??0) > now + 60) return cache.access_token;
  if (!cache.refresh_token) throw new Error("No Spotify refresh token. Re-authorize via Spotify OAuth.");
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({grant_type:"refresh_token",refresh_token:cache.refresh_token}).toString();
  const res = await httpPost(TOKEN_URL, body, {"Content-Type":"application/x-www-form-urlencoded","Authorization":`Basic ${creds}`});
  const data = JSON.parse(res);
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data).slice(0,200)}`);
  cache.access_token = data.access_token;
  if (data.refresh_token) cache.refresh_token = data.refresh_token;
  cache.expires_at = now + (data.expires_in??3600);
  saveCache(cache);
  return data.access_token;
}

async function api(method: string, path: string, token: string, body?: unknown): Promise<unknown> {
  const res = await httpReq(method, `${SPOTIFY_API}${path}`, token, body ? JSON.stringify(body) : undefined);
  if (res.status === 204 || !res.body.trim()) return null;
  if (res.status === 404) return null;
  if (res.status >= 400) throw new Error(`Spotify API ${res.status}: ${res.body.slice(0,300)}`);
  return JSON.parse(res.body);
}

function fmt(data: unknown) { return {content:[{type:"text" as const,text:JSON.stringify(data)}],details:{}}; }

const configSchema = {type:"object" as const, additionalProperties:false, properties:{
  clientId:{type:"string" as const,description:"Spotify app client ID"},
  clientSecret:{type:"string" as const,description:"Spotify app client secret"},
  redirectUri:{type:"string" as const,description:"OAuth2 redirect URI"},
}};

export function createEntry() {
  return {
    id:"spotify", name:"Spotify",
    description:"Control Spotify playback, search music, and manage playlists",
    contracts: { tools: ["spotify_now_playing", "spotify_play", "spotify_pause", "spotify_next", "spotify_previous", "spotify_search", "spotify_get_devices", "spotify_get_playlists", "spotify_add_to_playlist"] },
    configSchema,
    register(api_: PluginApi) {
      const creds = () => ({
        clientId: (api_.pluginConfig?.clientId as string)??process.env.SPOTIFY_CLIENT_ID??"",
        clientSecret: (api_.pluginConfig?.clientSecret as string)??process.env.SPOTIFY_CLIENT_SECRET??"",
      });

      api_.registerTool({ name:"spotify_now_playing", label:"Spotify Now Playing",
        description:"Get the currently playing item on Spotify, including playback details.",
        parameters: Type.Object({}),
        async execute() {
          try {
            const {clientId,clientSecret} = creds();
            const token = await getToken(clientId,clientSecret);
            const data = await api("GET","/me/player",token) as Record<string,unknown>|null;
            if (!data?.item) return fmt({playing:false});
            const item = data.item as Record<string,unknown>;
            const isEpisode = item.type==="episode";
            const result: Record<string,unknown> = {
              playing:data.is_playing, item_type:item.type, track:item.name,
              track_uri:item.uri, progress_ms:data.progress_ms, duration_ms:item.duration_ms,
            };
            if (isEpisode) {
              const show = (item.show??{}) as Record<string,string>;
              result.artist = show.publisher||show.name||""; result.album = show.name||""; result.show = show.name;
            } else {
              result.artist = ((item.artists??[]) as Array<{name:string}>).map(a=>a.name).join(", ");
              result.album = ((item.album as Record<string,string>|undefined)?.name)??"";
            }
            const device = data.device as Record<string,string>|undefined;
            if (device) result.device = device.name;
            return fmt(result);
          } catch(e) { return fmt({error:(e as Error).message}); }
        },
      });

      api_.registerTool({ name:"spotify_play", label:"Spotify Play",
        description:"Start or resume Spotify playback. Optionally provide a Spotify URI to play something specific.",
        parameters: Type.Object({
          uri: Type.Optional(Type.String({description:"Spotify URI to play (e.g. spotify:track:..., spotify:album:..., spotify:playlist:...). Omit to resume current playback."})),
          device_id: Type.Optional(Type.String({description:"Target device ID. Omit to use the active device."})),
        }),
        async execute(_id:string, p:Record<string,unknown>) {
          try {
            const {clientId,clientSecret} = creds();
            const token = await getToken(clientId,clientSecret);
            const qs = p.device_id ? `?device_id=${p.device_id}` : "";
            const uri = p.uri as string|undefined;
            let body: Record<string,unknown>|undefined;
            if (uri) {
              if (uri.includes(":track:")) body = {uris:[uri]};
              else body = {context_uri:uri};
            }
            await api("PUT",`/me/player/play${qs}`,token,body??{});
            return fmt({ok:true, playing:uri??true});
          } catch(e) { return fmt({error:(e as Error).message}); }
        },
      });

      api_.registerTool({ name:"spotify_pause", label:"Spotify Pause",
        description:"Pause Spotify playback.",
        parameters: Type.Object({ device_id: Type.Optional(Type.String({description:"Target device ID. Omit to use the active device."})) }),
        async execute(_id:string, p:Record<string,unknown>) {
          try {
            const {clientId,clientSecret} = creds(); const token = await getToken(clientId,clientSecret);
            const qs = p.device_id ? `?device_id=${p.device_id}` : "";
            await api("PUT",`/me/player/pause${qs}`,token,{});
            return fmt({ok:true, paused:true});
          } catch(e) { return fmt({error:(e as Error).message}); }
        },
      });

      api_.registerTool({ name:"spotify_next", label:"Spotify Next",
        description:"Skip to the next track in the Spotify queue.",
        parameters: Type.Object({ device_id: Type.Optional(Type.String({description:"Target device ID. Omit to use the active device."})) }),
        async execute(_id:string, p:Record<string,unknown>) {
          try {
            const {clientId,clientSecret} = creds(); const token = await getToken(clientId,clientSecret);
            const qs = p.device_id ? `?device_id=${p.device_id}` : "";
            await api("POST",`/me/player/next${qs}`,token,{});
            return fmt({ok:true});
          } catch(e) { return fmt({error:(e as Error).message}); }
        },
      });

      api_.registerTool({ name:"spotify_previous", label:"Spotify Previous",
        description:"Go back to the previous track on Spotify.",
        parameters: Type.Object({ device_id: Type.Optional(Type.String({description:"Target device ID. Omit to use the active device."})) }),
        async execute(_id:string, p:Record<string,unknown>) {
          try {
            const {clientId,clientSecret} = creds(); const token = await getToken(clientId,clientSecret);
            const qs = p.device_id ? `?device_id=${p.device_id}` : "";
            await api("POST",`/me/player/previous${qs}`,token,{});
            return fmt({ok:true});
          } catch(e) { return fmt({error:(e as Error).message}); }
        },
      });

      api_.registerTool({ name:"spotify_search", label:"Spotify Search",
        description:"Search Spotify for tracks, albums, artists, or playlists.",
        parameters: Type.Object({
          query: Type.String({description:"Search query (e.g. 'Daft Punk Digital Love', 'chill jazz playlist')."}),
          type: Type.Optional(Type.Union([Type.Literal("track"),Type.Literal("album"),Type.Literal("artist"),Type.Literal("playlist")],{description:"Type of result to search for (default: track)."})),
          limit: Type.Optional(Type.Integer({description:"Max number of results to return (default: 10, max: 50)."})),
        }),
        async execute(_id:string, p:Record<string,unknown>) {
          try {
            const {clientId,clientSecret} = creds(); const token = await getToken(clientId,clientSecret);
            const q = encodeURIComponent(String(p.query??"")); const type = String(p.type??"track"); const limit = Math.min(Number(p.limit??10),50);
            const data = await api("GET",`/search?q=${q}&type=${type}&limit=${limit}`,token) as Record<string,Record<string,unknown[]>>;
            const items = data?.[`${type}s`]?.items??[];
            return fmt({type, count:items.length, items});
          } catch(e) { return fmt({error:(e as Error).message}); }
        },
      });

      api_.registerTool({ name:"spotify_get_playlists", label:"Spotify Get Playlists",
        description:"List the current user's Spotify playlists with IDs and track counts.",
        parameters: Type.Object({ limit: Type.Optional(Type.Integer({description:"Max number of playlists to return (default: 20, max: 50)."})) }),
        async execute(_id:string, p:Record<string,unknown>) {
          try {
            const {clientId,clientSecret} = creds(); const token = await getToken(clientId,clientSecret);
            const limit = Math.min(Number(p.limit??20),50);
            const data = await api("GET",`/me/playlists?limit=${limit}`,token) as Record<string,unknown>;
            const playlists = ((data?.items??[]) as Array<Record<string,unknown>>).map(pl=>({id:pl.id,name:pl.name,tracks:(pl.tracks as Record<string,number>|undefined)?.total??0,uri:pl.uri}));
            return fmt({playlists, count:playlists.length});
          } catch(e) { return fmt({error:(e as Error).message}); }
        },
      });

      api_.registerTool({ name:"spotify_get_devices", label:"Spotify Get Devices",
        description:"List available Spotify Connect devices (speakers, phones, computers) with their IDs and active status.",
        parameters: Type.Object({}),
        async execute() {
          try {
            const {clientId,clientSecret} = creds(); const token = await getToken(clientId,clientSecret);
            const data = await api("GET","/me/player/devices",token) as {devices:Array<Record<string,unknown>>};
            return fmt({devices:data?.devices??[]});
          } catch(e) { return fmt({error:(e as Error).message}); }
        },
      });

      api_.registerTool({ name:"spotify_add_to_playlist", label:"Spotify Add to Playlist",
        description:"Add a track to a Spotify playlist by playlist ID and track URI.",
        parameters: Type.Object({
          playlist_id: Type.String({description:"Spotify playlist ID (from spotify_get_playlists)."}),
          track_uri: Type.String({description:"Spotify track URI to add (e.g. spotify:track:...)."}),
        }),
        async execute(_id:string, p:Record<string,unknown>) {
          try {
            const {clientId,clientSecret} = creds(); const token = await getToken(clientId,clientSecret);
            const playlistId = String(p.playlist_id??"").trim();
            const trackUri = String(p.track_uri??"").trim();
            if (!playlistId||!trackUri) return fmt({error:"playlist_id and track_uri are required"});
            await api("POST",`/playlists/${playlistId}/tracks`,token,{uris:[trackUri]});
            return fmt({ok:true, playlist_id:playlistId, track_uri:trackUri});
          } catch(e) { return fmt({error:(e as Error).message}); }
        },
      });
    },
  };
}
