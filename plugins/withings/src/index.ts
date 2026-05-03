/**
 * Withings plugin — pure TS-native implementation.
 * OAuth2 flow + health data fetching.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import http from "node:http";
import path from "node:path";
import { Type } from "@sinclair/typebox";

type PluginApi = { registerTool: (t: unknown) => void; pluginConfig?: Record<string, unknown> };

const HOME = process.env.HOME ?? "/home/openclaw";
const TOKEN_FILE = path.join(HOME, ".openclaw/withings_tokens.json");
const AUTH_BASE = "https://account.withings.com/oauth2_user/authorize2";
const TOKEN_URL = "https://wbsapi.withings.net/v2/oauth2";
const API_BASE = "https://wbsapi.withings.net";
const SCOPES = "user.info,user.metrics,user.activity";

const MEAS_TYPES: Record<number,string> = {
  1:"Weight (kg)",4:"Height (m)",5:"Fat-free mass (kg)",6:"Fat ratio (%)",8:"Fat mass weight (kg)",
  9:"Diastolic BP (mmHg)",10:"Systolic BP (mmHg)",11:"Heart pulse (bpm)",12:"Temperature (°C)",
  54:"SPO2 (%)",71:"Body temperature (°C)",73:"Skin temperature (°C)",76:"Muscle mass (kg)",
  77:"Hydration (kg)",88:"Bone mass (kg)",91:"Pulse wave velocity (m/s)",123:"VO2 max (mL/kg/min)",
  135:"QRS duration (ms)",136:"PR duration (ms)",137:"QT duration (ms)",138:"Corrected QT duration (ms)",
  139:"Atrial fibrillation (detected=1)",
};

function httpPost(url: string, body: string, headers: Record<string,string>): Promise<{status:number;body:string}> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.request(url, {method:"POST", headers, timeout:30_000}, res => {
      let data=""; res.on("data",(c:Buffer)=>data+=c); res.on("end",()=>resolve({status:res.statusCode??0,body:data}));
    });
    req.on("error",reject); req.on("timeout",()=>{req.destroy();reject(new Error("timeout"));});
    req.write(body); req.end();
  });
}

function httpGet(url: string, headers: Record<string,string>): Promise<{status:number;body:string}> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {method:"GET", headers, timeout:30_000}, res => {
      let data=""; res.on("data",(c:Buffer)=>data+=c); res.on("end",()=>resolve({status:res.statusCode??0,body:data}));
    });
    req.on("error",reject); req.on("timeout",()=>{req.destroy();reject(new Error("timeout"));});
    req.end();
  });
}

function loadTokens(): Record<string,unknown> {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE,"utf8")); } catch { return {}; }
}
function saveTokens(t: Record<string,unknown>) {
  fs.mkdirSync(path.dirname(TOKEN_FILE),{recursive:true}); fs.writeFileSync(TOKEN_FILE,JSON.stringify(t,null,2));
}

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  let tokens = loadTokens();
  if (!tokens.access_token) throw new Error("No Withings account linked. Use withings_auth_url to start OAuth.");
  const now = Date.now()/1000;
  if (Number(tokens.expires_at??0) - 60 < now) {
    const body = new URLSearchParams({action:"refreshaccesstoken",grant_type:"refresh_token",client_id:clientId,client_secret:clientSecret,refresh_token:String(tokens.refresh_token)}).toString();
    const res = await httpPost(TOKEN_URL, body, {"Content-Type":"application/x-www-form-urlencoded"});
    const data = JSON.parse(res.body);
    if (data.status !== 0) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
    tokens.access_token = data.body.access_token;
    tokens.refresh_token = data.body.refresh_token ?? tokens.refresh_token;
    tokens.expires_at = now + (data.body.expires_in ?? 10800);
    saveTokens(tokens);
  }
  return String(tokens.access_token);
}

async function apiPost(clientId: string, clientSecret: string, endpoint: string, params: Record<string,string|number>): Promise<{output?:unknown;error?:string}> {
  try {
    const token = await getAccessToken(clientId, clientSecret);
    const body = new URLSearchParams(Object.entries(params).map(([k,v])=>[k,String(v)])).toString();
    const res = await httpPost(`${API_BASE}${endpoint}`, body, {Authorization:`Bearer ${token}`,"Content-Type":"application/x-www-form-urlencoded"});
    const data = JSON.parse(res.body);
    if (data.status !== 0) return {error:`API error ${data.status}: ${JSON.stringify(data)}`};
    return {output: data.body};
  } catch(e) { return {error:(e as Error).message}; }
}

async function apiGet(clientId: string, clientSecret: string, endpoint: string, params: Record<string,string|number>): Promise<{output?:unknown;error?:string}> {
  try {
    const token = await getAccessToken(clientId, clientSecret);
    const qs = new URLSearchParams(Object.entries(params).map(([k,v])=>[k,String(v)])).toString();
    const res = await httpGet(`${API_BASE}${endpoint}?${qs}`, {Authorization:`Bearer ${token}`});
    const data = JSON.parse(res.body);
    if (data.status !== 0) return {error:`API error ${data.status}: ${JSON.stringify(data)}`};
    return {output: data.body};
  } catch(e) { return {error:(e as Error).message}; }
}

function daysAgo(days: number): number { return Math.floor((Date.now() - days*86400000)/1000); }
function dateStr(days: number): string { return new Date(Date.now()-days*86400000).toISOString().slice(0,10); }
function fmt(data: unknown) { return {content:[{type:"text" as const,text:JSON.stringify(data)}],details:{}}; }

const configSchema = { type:"object" as const, additionalProperties:false, properties:{
  clientId:{type:"string" as const,description:"Withings OAuth2 client ID"},
  clientSecret:{type:"string" as const,description:"Withings OAuth2 client secret"},
  redirectUri:{type:"string" as const,description:"OAuth2 redirect URI"},
}};

export function createEntry() {
  return {
    id:"withings", name:"Withings",
    description:"Fetch health data from Withings devices (weight, body composition, heart rate, sleep, activity)",
    configSchema,
    register(api: PluginApi) {
      const cfg = () => ({
        clientId: (api.pluginConfig?.clientId as string)??process.env.WITHINGS_CLIENT_ID??"",
        clientSecret: (api.pluginConfig?.clientSecret as string)??process.env.WITHINGS_CLIENT_SECRET??"",
        redirectUri: (api.pluginConfig?.redirectUri as string)??process.env.WITHINGS_REDIRECT_URI??"http://localhost:18789/plugins/withings/oauth/callback",
      });

      api.registerTool({ name:"withings_auth_url", label:"Withings Auth URL",
        description:"Generate a Withings OAuth2 authorization URL. Open this URL in a browser to link a Withings account.",
        parameters: Type.Object({}),
        async execute() {
          const {clientId,clientSecret:_,redirectUri} = cfg();
          if (!clientId) return fmt({error:"WITHINGS_CLIENT_ID is not set"});
          const state = crypto.randomBytes(16).toString("hex");
          const url = AUTH_BASE + "?" + new URLSearchParams({response_type:"code",client_id:clientId,redirect_uri:redirectUri,scope:SCOPES,state}).toString();
          return fmt({url, state, redirect_uri:redirectUri, instructions:`Open the URL in your browser. After authorizing, copy the 'code' from the redirect URL and call withings_auth_complete.`});
        },
      });

      api.registerTool({ name:"withings_auth_complete", label:"Withings Auth Complete",
        description:"Complete Withings OAuth2 flow by exchanging the authorization code for tokens.",
        parameters: Type.Object({ code: Type.String({description:"The authorization code from the Withings redirect URL."}) }),
        async execute(_id:string, p:Record<string,unknown>) {
          const {clientId,clientSecret,redirectUri} = cfg();
          if (!clientId||!clientSecret) return fmt({error:"WITHINGS_CLIENT_ID and WITHINGS_CLIENT_SECRET must be set"});
          const code = String(p.code??"").trim();
          if (!code) return fmt({error:"code is required"});
          try {
            const body = new URLSearchParams({action:"requesttoken",grant_type:"authorization_code",client_id:clientId,client_secret:clientSecret,code,redirect_uri:redirectUri}).toString();
            const res = await httpPost(TOKEN_URL, body, {"Content-Type":"application/x-www-form-urlencoded"});
            const data = JSON.parse(res.body);
            if (data.status!==0) return fmt({error:`Token exchange failed: ${JSON.stringify(data)}`});
            const b = data.body;
            const tokens = {access_token:b.access_token,refresh_token:b.refresh_token,expires_at:Date.now()/1000+(b.expires_in??10800),userid:b.userid};
            saveTokens(tokens);
            return fmt({success:true, userid:tokens.userid, expires_at:new Date(tokens.expires_at*1000).toISOString(), message:"Withings account linked successfully."});
          } catch(e) { return fmt({error:(e as Error).message}); }
        },
      });

      api.registerTool({ name:"withings_auth_status", label:"Withings Auth Status",
        description:"Check whether a Withings account is currently linked and whether the access token is valid.",
        parameters: Type.Object({}),
        async execute() {
          const tokens = loadTokens();
          if (!tokens.access_token) return fmt({linked:false, message:"No account linked. Run withings_auth_url to connect."});
          const expired = Date.now()/1000 >= Number(tokens.expires_at??0)-60;
          return fmt({linked:true, userid:tokens.userid, expires_at:new Date(Number(tokens.expires_at)*1000).toISOString(), needs_refresh:expired});
        },
      });

      api.registerTool({ name:"withings_get_measurements", label:"Withings Measurements",
        description:"Fetch body measurements from Withings: weight, body fat %, BMI, blood pressure, heart rate, and more.",
        parameters: Type.Object({
          days_back: Type.Optional(Type.Integer({description:"How many days of history to fetch (default: 7)."})),
          meastypes: Type.Optional(Type.String({description:"Optional comma-separated measurement type IDs (e.g. '1,6' for weight and fat ratio)."})),
        }),
        async execute(_id:string, p:Record<string,unknown>) {
          const {clientId,clientSecret} = cfg();
          const days = Number(p.days_back??7);
          const params: Record<string,string|number> = {action:"getmeas",startdate:daysAgo(days),category:1};
          if (p.meastypes) params.meastypes = String(p.meastypes);
          const res = await apiPost(clientId, clientSecret, "/measure", params);
          if (res.error) return fmt({error:res.error});
          const groups = ((res.output as Record<string,unknown>).measuregrps??[]) as Array<Record<string,unknown>>;
          const measurements = groups.map(g => ({
            timestamp: new Date(Number(g.date)*1000).toISOString(),
            measures: ((g.measures??[]) as Array<{value:number;unit:number;type:number}>).map(m => ({
              type: MEAS_TYPES[m.type]??`type_${m.type}`,
              value: Math.round(m.value*(10**m.unit)*10000)/10000,
            })),
          }));
          return fmt({measurements, count:measurements.length});
        },
      });

      api.registerTool({ name:"withings_get_activity", label:"Withings Activity",
        description:"Fetch daily activity summaries from Withings: steps, distance, calories, and active/light/moderate/intense minutes.",
        parameters: Type.Object({ days_back: Type.Optional(Type.Integer({description:"How many days of history to fetch (default: 7)."})) }),
        async execute(_id:string, p:Record<string,unknown>) {
          const {clientId,clientSecret} = cfg();
          const days = Number(p.days_back??7);
          const res = await apiGet(clientId, clientSecret, "/v2/measure", {action:"getactivity",startdateymd:dateStr(days),enddateymd:dateStr(0),data_fields:"steps,distance,totalcalories,active,soft,moderate,intense"});
          if (res.error) return fmt({error:res.error});
          const activities = ((res.output as Record<string,unknown>).activities??[]) as unknown[];
          return fmt({activities, count:activities.length});
        },
      });

      api.registerTool({ name:"withings_get_sleep", label:"Withings Sleep",
        description:"Fetch sleep summary data from Withings: total sleep time, REM, deep sleep, light sleep, sleep score, snoring, and wake count.",
        parameters: Type.Object({ days_back: Type.Optional(Type.Integer({description:"How many days of history to fetch (default: 7)."})) }),
        async execute(_id:string, p:Record<string,unknown>) {
          const {clientId,clientSecret} = cfg();
          const days = Number(p.days_back??7);
          const res = await apiGet(clientId, clientSecret, "/v2/sleep", {action:"getsummary",startdateymd:dateStr(days),enddateymd:dateStr(0),data_fields:"nb_rem_episodes,sleep_score,snoring,snoring_episode_count,sleep_efficiency,total_sleep_time,total_timeinbed,wakeup_count,deepsleepduration,lightsleepduration,remsleepduration,wakeupduration"});
          if (res.error) return fmt({error:res.error});
          const series = ((res.output as Record<string,unknown>).series??[]) as Array<Record<string,unknown>>;
          const summaries = series.map(s => ({
            date: s.date, ...((s.data??{}) as Record<string,unknown>),
            startdate: s.startdate ? new Date(Number(s.startdate)*1000).toISOString() : undefined,
            enddate: s.enddate ? new Date(Number(s.enddate)*1000).toISOString() : undefined,
          }));
          return fmt({sleep_summaries:summaries, count:summaries.length});
        },
      });

      api.registerTool({ name:"withings_get_heart", label:"Withings Heart",
        description:"Fetch heart rate and ECG records from Withings, including AFib classification where available.",
        parameters: Type.Object({ days_back: Type.Optional(Type.Integer({description:"How many days of history to fetch (default: 7)."})) }),
        async execute(_id:string, p:Record<string,unknown>) {
          const {clientId,clientSecret} = cfg();
          const days = Number(p.days_back??7);
          const now = Math.floor(Date.now()/1000);
          const res = await apiGet(clientId, clientSecret, "/v2/heart", {action:"list",startdate:daysAgo(days),enddate:now});
          if (res.error) return fmt({error:res.error});
          const series = ((res.output as Record<string,unknown>).series??[]) as Array<Record<string,unknown>>;
          const records = series.map(s => ({
            timestamp: new Date(Number(s.timestamp)*1000).toISOString(),
            heart_rate: (s.heart_rate as Record<string,unknown>|undefined)?.value,
            ecg: s.ecg ? "available" : null,
            afib_classification: (s.afib as Record<string,unknown>|undefined)?.afib_classification,
          }));
          return fmt({heart_records:records, count:records.length});
        },
      });
    },
  };
}
