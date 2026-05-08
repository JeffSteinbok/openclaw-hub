/**
 * Withings — core handlers.
 * Pure logic with no knowledge of how it's invoked.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import http from "node:http";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WithingsConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenFilePath: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTH_BASE = "https://account.withings.com/oauth2_user/authorize2";
const TOKEN_URL = "https://wbsapi.withings.net/v2/oauth2";
const API_BASE = "https://wbsapi.withings.net";
const SCOPES = "user.info,user.metrics,user.activity";

export const MEAS_TYPES: Record<number, string> = {
  1: "Weight (kg)", 4: "Height (m)", 5: "Fat-free mass (kg)", 6: "Fat ratio (%)", 8: "Fat mass weight (kg)",
  9: "Diastolic BP (mmHg)", 10: "Systolic BP (mmHg)", 11: "Heart pulse (bpm)", 12: "Temperature (°C)",
  54: "SPO2 (%)", 71: "Body temperature (°C)", 73: "Skin temperature (°C)", 76: "Muscle mass (kg)",
  77: "Hydration (kg)", 88: "Bone mass (kg)", 91: "Pulse wave velocity (m/s)", 123: "VO2 max (mL/kg/min)",
  135: "QRS duration (ms)", 136: "PR duration (ms)", 137: "QT duration (ms)", 138: "Corrected QT duration (ms)",
  139: "Atrial fibrillation (detected=1)",
};

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpPost(url: string, body: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.request(url, { method: "POST", headers, timeout: 30_000 }, res => {
      let data = ""; res.on("data", (c: Buffer) => data += c); res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", reject); req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.write(body); req.end();
  });
}

function httpGet(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: "GET", headers, timeout: 30_000 }, res => {
      let data = ""; res.on("data", (c: Buffer) => data += c); res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", reject); req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

function loadTokens(tokenFilePath: string): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(tokenFilePath, "utf8")); } catch { return {}; }
}

function saveTokens(tokenFilePath: string, t: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(tokenFilePath), { recursive: true });
  fs.writeFileSync(tokenFilePath, JSON.stringify(t, null, 2));
}

async function getAccessToken(config: WithingsConfig): Promise<string> {
  let tokens = loadTokens(config.tokenFilePath);
  if (!tokens.access_token) throw new Error("No Withings account linked. Use withings_auth_url to start OAuth.");
  const now = Date.now() / 1000;
  if (Number(tokens.expires_at ?? 0) - 60 < now) {
    const body = new URLSearchParams({ action: "requesttoken", grant_type: "refresh_token", client_id: config.clientId, client_secret: config.clientSecret, refresh_token: String(tokens.refresh_token) }).toString();
    const res = await httpPost(TOKEN_URL, body, { "Content-Type": "application/x-www-form-urlencoded" });
    const data = JSON.parse(res.body);
    if (data.status !== 0) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
    tokens.access_token = data.body.access_token;
    tokens.refresh_token = data.body.refresh_token ?? tokens.refresh_token;
    tokens.expires_at = now + (data.body.expires_in ?? 10800);
    saveTokens(config.tokenFilePath, tokens);
  }
  return String(tokens.access_token);
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiPost(config: WithingsConfig, endpoint: string, params: Record<string, string | number>): Promise<{ output?: unknown; error?: string }> {
  try {
    const token = await getAccessToken(config);
    const body = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
    const res = await httpPost(`${API_BASE}${endpoint}`, body, { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" });
    const data = JSON.parse(res.body);
    if (data.status !== 0) return { error: `API error ${data.status}: ${JSON.stringify(data)}` };
    return { output: data.body };
  } catch (e) { return { error: (e as Error).message }; }
}

async function apiGet(config: WithingsConfig, endpoint: string, params: Record<string, string | number>): Promise<{ output?: unknown; error?: string }> {
  try {
    const token = await getAccessToken(config);
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
    const res = await httpGet(`${API_BASE}${endpoint}?${qs}`, { Authorization: `Bearer ${token}` });
    const data = JSON.parse(res.body);
    if (data.status !== 0) return { error: `API error ${data.status}: ${JSON.stringify(data)}` };
    return { output: data.body };
  } catch (e) { return { error: (e as Error).message }; }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

export function daysAgo(days: number): number { return Math.floor((Date.now() - days * 86400000) / 1000); }
export function dateStr(days: number): string { return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10); }

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

export function handleAuthUrl(config: WithingsConfig): Record<string, unknown> {
  if (!config.clientId) return { error: "WITHINGS_CLIENT_ID is not set" };
  const state = crypto.randomBytes(16).toString("hex");
  const url = AUTH_BASE + "?" + new URLSearchParams({ response_type: "code", client_id: config.clientId, redirect_uri: config.redirectUri, scope: SCOPES, state }).toString();
  return { url, state, redirect_uri: config.redirectUri, instructions: `Open the URL in your browser. After authorizing, copy the 'code' from the redirect URL and call withings_auth_complete.` };
}

export async function handleAuthComplete(config: WithingsConfig, params: { code: string }): Promise<Record<string, unknown>> {
  if (!config.clientId || !config.clientSecret) return { error: "WITHINGS_CLIENT_ID and WITHINGS_CLIENT_SECRET must be set" };
  const code = params.code.trim();
  if (!code) return { error: "code is required" };
  try {
    const body = new URLSearchParams({ action: "requesttoken", grant_type: "authorization_code", client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: config.redirectUri }).toString();
    const res = await httpPost(TOKEN_URL, body, { "Content-Type": "application/x-www-form-urlencoded" });
    const data = JSON.parse(res.body);
    if (data.status !== 0) return { error: `Token exchange failed: ${JSON.stringify(data)}` };
    const b = data.body;
    const tokens = { access_token: b.access_token, refresh_token: b.refresh_token, expires_at: Date.now() / 1000 + (b.expires_in ?? 10800), userid: b.userid };
    saveTokens(config.tokenFilePath, tokens);
    return { success: true, userid: tokens.userid, expires_at: new Date(tokens.expires_at * 1000).toISOString(), message: "Withings account linked successfully." };
  } catch (e) { return { error: (e as Error).message }; }
}

export function handleAuthStatus(config: WithingsConfig): Record<string, unknown> {
  const tokens = loadTokens(config.tokenFilePath);
  if (!tokens.access_token) return { linked: false, message: "No account linked. Run withings_auth_url to connect." };
  const expired = Date.now() / 1000 >= Number(tokens.expires_at ?? 0) - 60;
  return { linked: true, userid: tokens.userid, expires_at: new Date(Number(tokens.expires_at) * 1000).toISOString(), needs_refresh: expired };
}

export async function handleGetMeasurements(config: WithingsConfig, params: { days_back?: number; meastypes?: string }): Promise<Record<string, unknown>> {
  const days = params.days_back ?? 7;
  const apiParams: Record<string, string | number> = { action: "getmeas", startdate: daysAgo(days), category: 1 };
  if (params.meastypes) apiParams.meastypes = params.meastypes;
  const res = await apiPost(config, "/measure", apiParams);
  if (res.error) return { error: res.error };
  const groups = ((res.output as Record<string, unknown>).measuregrps ?? []) as Array<Record<string, unknown>>;
  const measurements = groups.map(g => ({
    timestamp: new Date(Number(g.date) * 1000).toISOString(),
    measures: ((g.measures ?? []) as Array<{ value: number; unit: number; type: number }>).map(m => ({
      type: MEAS_TYPES[m.type] ?? `type_${m.type}`,
      value: Math.round(m.value * (10 ** m.unit) * 10000) / 10000,
    })),
  }));
  return { measurements, count: measurements.length };
}

export async function handleGetActivity(config: WithingsConfig, params: { days_back?: number }): Promise<Record<string, unknown>> {
  const days = params.days_back ?? 7;
  const res = await apiGet(config, "/v2/measure", { action: "getactivity", startdateymd: dateStr(days), enddateymd: dateStr(0), data_fields: "steps,distance,totalcalories,active,soft,moderate,intense" });
  if (res.error) return { error: res.error };
  const activities = ((res.output as Record<string, unknown>).activities ?? []) as unknown[];
  return { activities, count: activities.length };
}

export async function handleGetSleep(config: WithingsConfig, params: { days_back?: number }): Promise<Record<string, unknown>> {
  const days = params.days_back ?? 7;
  const res = await apiGet(config, "/v2/sleep", { action: "getsummary", startdateymd: dateStr(days), enddateymd: dateStr(0), data_fields: "nb_rem_episodes,sleep_score,snoring,snoring_episode_count,sleep_efficiency,total_sleep_time,total_timeinbed,wakeup_count,deepsleepduration,lightsleepduration,remsleepduration,wakeupduration" });
  if (res.error) return { error: res.error };
  const series = ((res.output as Record<string, unknown>).series ?? []) as Array<Record<string, unknown>>;
  const summaries = series.map(s => ({
    date: s.date, ...((s.data ?? {}) as Record<string, unknown>),
    startdate: s.startdate ? new Date(Number(s.startdate) * 1000).toISOString() : undefined,
    enddate: s.enddate ? new Date(Number(s.enddate) * 1000).toISOString() : undefined,
  }));
  return { sleep_summaries: summaries, count: summaries.length };
}

export async function handleGetHeart(config: WithingsConfig, params: { days_back?: number }): Promise<Record<string, unknown>> {
  const days = params.days_back ?? 7;
  const now = Math.floor(Date.now() / 1000);
  const res = await apiGet(config, "/v2/heart", { action: "list", startdate: daysAgo(days), enddate: now });
  if (res.error) return { error: res.error };
  const series = ((res.output as Record<string, unknown>).series ?? []) as Array<Record<string, unknown>>;
  const records = series.map(s => ({
    timestamp: new Date(Number(s.timestamp) * 1000).toISOString(),
    heart_rate: (s.heart_rate as Record<string, unknown> | undefined)?.value,
    ecg: s.ecg ? "available" : null,
    afib_classification: (s.afib as Record<string, unknown> | undefined)?.afib_classification,
  }));
  return { heart_records: records, count: records.length };
}
