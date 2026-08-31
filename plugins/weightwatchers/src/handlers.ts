/**
 * WeightWatchers — core handlers.
 *
 * Pure logic with no knowledge of how it's invoked (plugin vs CLI).
 * Config is passed in; handlers never read env vars or plugin APIs directly.
 */

import fs from "node:fs";
import https from "node:https";
import http from "node:http";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WWConfig {
  jwt?: string;
  email?: string;
  password?: string;
  tld: string;
}

export interface DailyParams {
  date?: string;
}

export interface SearchParams {
  query: string;
  limit?: number;
}

export interface LogParams {
  food_id: string;
  version_id: string;
  portion_id: string;
  portion_size?: number;
  date?: string;
  meal_type?: string;
  source_type?: string;
}

export interface PointsParams {
  calories: number;
  saturated_fat: number;
  sugar: number;
  protein: number;
}

export interface BudgetParams {
  date?: string;
}

export interface QuickAddParams {
  points: number;
  name?: string;
  meal_type?: string;
  date?: string;
}

export interface DeleteParams {
  tracking_id: string;
  date?: string;
}

export interface SearchMealsParams {
  query?: string;
  type?: string;
}

export interface LogMealParams {
  meal_id: string;
  type: string;
  meal_type?: string;
  date?: string;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpRequest(
  method: "GET" | "POST" | "DELETE",
  url: string,
  headers: Record<string, string>,
  body?: string,
  timeoutMs = 30_000,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const opts = { method, headers, timeout: timeoutMs };
    const req = mod.request(url, opts, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => (data += chunk));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers as Record<string, string>,
          body: data,
        }),
      );
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    if (body) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

function localDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function makeEndpoints(tld: string) {
  const base = `https://cmx.weightwatchers.${tld}`;
  const auth = `https://auth.weightwatchers.${tld}`;
  return {
    login_step1: `${auth}/login-apis/v1/authenticate`,
    login_step2: `${auth}/openam/oauth2/authorize?response_type=id_token&client_id=webCMX&redirect_uri=https%3A%2F%2Fcmx.weightwatchers.${tld}%2Fauth`,
    my_day: `${base}/api/v3/cmx/operations/composed/members/~/my-day/{date}`,
    food_search: `${base}/api/v3/search/foods`,
    tracked_foods: `${base}/api/v4/cmx/members/~/trackedFoods/{date}`,
    tracked_foods_v3: `${base}/api/v3/cmx/members/~/trackedFoods/{date}`,
    tracked_food_item: `${base}/api/v3/cmx/members/~/trackedFoods/{date}/{tracking_id}`,
    tracked_food_item_v4: `${base}/api/v4/cmx/members/~/trackedFoods/{date}/{tracking_id}`,
    custom_meals: `${base}/api/v3/cmx/members/~/custom-foods/meals`,
    custom_recipes: `${base}/api/v3/cmx/members/~/custom-foods/recipes`,
    custom_foods_list: `${base}/api/v3/cmx/members/~/custom-foods/foods`,
  };
}

// ---------------------------------------------------------------------------
// SmartPoints formula
// ---------------------------------------------------------------------------

export function calculateSmartPoints(calories: number, saturatedFat: number, sugar: number, protein: number): number {
  const raw = calories * 0.0305 + saturatedFat * 0.275 + sugar * 0.12 - protein * 0.098;
  return Math.max(0, Math.round(raw));
}

// ---------------------------------------------------------------------------
// JWT auth
// ---------------------------------------------------------------------------

const JWT_CACHE_PATH = path.join(process.env.HOME ?? "~", ".openclaw", "ww_jwt_cache");

function saveJwtCache(jwt: string) {
  try {
    fs.writeFileSync(JWT_CACHE_PATH, jwt, "utf8");
  } catch {}
}

function loadJwtCache(): string | null {
  try {
    const jwt = fs.readFileSync(JWT_CACHE_PATH, "utf8").trim();
    if (!jwt) return null;
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if ((payload.exp ?? 0) < Date.now() / 1000) return null;
    return jwt;
  } catch {
    return null;
  }
}

async function loginStep1(email: string, password: string, endpoints: ReturnType<typeof makeEndpoints>): Promise<string> {
  const res = await httpRequest("POST", endpoints.login_step1, { "Content-Type": "application/json" },
    JSON.stringify({ username: email, password, rememberMe: false, usernameEncoded: false, retry: false }));
  if (res.status !== 200) throw new Error(`Login step1 failed: HTTP ${res.status}`);
  const data = JSON.parse(res.body);
  const tokenId = data?.data?.tokenId;
  if (!tokenId) throw new Error("No tokenId in login response");
  return tokenId;
}

async function loginStep2(tokenId: string, endpoints: ReturnType<typeof makeEndpoints>): Promise<string> {
  const nonce = Math.random().toString(16).slice(2);
  const url = `${endpoints.login_step2}&nonce=${nonce}`;
  const res = await httpRequest("GET", url, { Cookie: `wwAuth2=${tokenId}` });
  const location = res.headers["location"] ?? "";
  if (!location) throw new Error("No Location header in OAuth2 redirect");
  const fragment = new URL(location.replace("#", "?")).searchParams;
  const jwt = fragment.get("id_token");
  if (!jwt) throw new Error("No id_token in redirect fragment");
  return jwt;
}

async function getJwt(cfg: WWConfig, endpoints: ReturnType<typeof makeEndpoints>): Promise<string> {
  // 1. Check cache
  const cached = loadJwtCache();
  if (cached) return cached;

  // 2. Config/env JWT
  let jwt = cfg.jwt ?? (process.env.WW_JWT ?? "").trim();
  if (jwt) {
    if (jwt.startsWith("Bearer ")) jwt = jwt.slice(7);
    return jwt;
  }

  // 3. Email/password login
  const email = cfg.email ?? (process.env.WW_EMAIL ?? "").trim();
  const password = cfg.password ?? (process.env.WW_PASSWORD ?? "").trim();
  if (!email || !password) throw new Error("Set WW_JWT or WW_EMAIL + WW_PASSWORD in config or .env");

  const tokenId = await loginStep1(email, password, endpoints);
  jwt = await loginStep2(tokenId, endpoints);
  saveJwtCache(jwt);
  return jwt;
}

async function reauth(cfg: WWConfig, endpoints: ReturnType<typeof makeEndpoints>): Promise<string | null> {
  const email = cfg.email ?? (process.env.WW_EMAIL ?? "").trim();
  const password = cfg.password ?? (process.env.WW_PASSWORD ?? "").trim();
  if (!email || !password) return null;
  try {
    const tokenId = await loginStep1(email, password, endpoints);
    const jwt = await loginStep2(tokenId, endpoints);
    saveJwtCache(jwt);
    return jwt;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiGet(
  url: string,
  jwt: string,
  cfg: WWConfig,
  endpoints: ReturnType<typeof makeEndpoints>,
  params?: Record<string, string | number>,
  retried = false,
): Promise<unknown> {
  let fullUrl = url;
  if (params) {
    const qs = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
    fullUrl = `${url}?${qs}`;
  }
  const res = await httpRequest("GET", fullUrl, { Authorization: `Bearer ${jwt}` });
  if (res.status === 401 && !retried) {
    const newJwt = await reauth(cfg, endpoints);
    if (newJwt) return apiGet(url, newJwt, cfg, endpoints, params, true);
  }
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status} from ${fullUrl}`);
  return JSON.parse(res.body);
}

async function apiPost(
  url: string,
  jwt: string,
  cfg: WWConfig,
  endpoints: ReturnType<typeof makeEndpoints>,
  body: unknown,
  retried = false,
): Promise<unknown> {
  const res = await httpRequest("POST", url,
    { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    JSON.stringify(body));
  if (res.status === 401 && !retried) {
    const newJwt = await reauth(cfg, endpoints);
    if (newJwt) return apiPost(url, newJwt, cfg, endpoints, body, true);
  }
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status} from ${url}`);
  return JSON.parse(res.body);
}

async function apiDelete(
  url: string,
  jwt: string,
  cfg: WWConfig,
  endpoints: ReturnType<typeof makeEndpoints>,
  body?: unknown,
  retried = false,
): Promise<unknown> {
  const headers: Record<string, string> = { Authorization: `Bearer ${jwt}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await httpRequest("DELETE", url, headers, body !== undefined ? JSON.stringify(body) : undefined);
  if (res.status === 401 && !retried) {
    const newJwt = await reauth(cfg, endpoints);
    if (newJwt) return apiDelete(url, newJwt, cfg, endpoints, body, true);
  }
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`HTTP ${res.status} from ${url}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  try { return res.body.trim() ? JSON.parse(res.body) : {}; } catch { return {}; }
}

/**
 * Deletes a single tracked food item.
 *
 * Quick-add entries are logged through the v4 API and 404 when deleted via v3,
 * so try v4 first and fall back to v3, which covers regular entries.
 */
async function deleteTrackedItem(
  targetDate: string,
  itemId: string,
  jwt: string,
  cfg: WWConfig,
  endpoints: ReturnType<typeof makeEndpoints>,
): Promise<void> {
  const v4Url = endpoints.tracked_food_item_v4.replace("{date}", targetDate).replace("{tracking_id}", itemId);
  try {
    await apiDelete(v4Url, jwt, cfg, endpoints, undefined);
    return;
  } catch (e) {
    if ((e as Error & { status?: number }).status !== 404) throw e;
  }
  const v3Url = endpoints.tracked_food_item.replace("{date}", targetDate).replace("{tracking_id}", itemId);
  await apiDelete(v3Url, jwt, cfg, endpoints, undefined);
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

function first(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (k in obj) return obj[k];
  return undefined;
}

const MEAL_MAP: Record<string, string> = {
  breakfast: "morning",
  lunch: "midday",
  dinner: "evening",
  snacks: "anytime",
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function wwDaily(params: DailyParams, cfg: WWConfig): Promise<unknown> {
  try {
    const ep = makeEndpoints(cfg.tld);
    const jwt = await getJwt(cfg, ep);
    const targetDate = params.date ?? localDateString();
    const data = await apiGet(ep.my_day.replace("{date}", targetDate), jwt, cfg, ep) as Record<string, unknown>;
    const today = (data.today ?? {}) as Record<string, unknown>;
    const tracked = (today.trackedFoods ?? {}) as Record<string, unknown[]>;
    const meals: Record<string, unknown[]> = {};
    for (const [key, label] of [["morning","Breakfast"],["midday","Lunch"],["evening","Dinner"],["anytime","Snacks"]]) {
      const foods = (tracked[key] ?? []) as Array<Record<string, unknown>>;
      if (!foods.length) continue;
      meals[label] = foods.map(f => ({
        tracking_id: f.entryId ?? f._id ?? f.trackingId ?? "",
        entry_id: f.entryId ?? "",
        is_quick_add: f.sourceType === "MEMBERFOODQUICK",
        name: f.name ?? "Unknown",
        points: first(f, "smartPoints", "points"),
        portion_size: f.portionSize ?? "",
        portion_name: f.portionName ?? "",
      }));
    }
    const budgetInfo = (today.pointsDetails ?? today.budget ?? {}) as Record<string, unknown>;
    return { date: targetDate, meals, budget: {
      daily_target: first(budgetInfo, "dailyPointTarget", "daily", "dailyPoints"),
      used: first(budgetInfo, "dailyPointsUsed", "used", "pointsUsed"),
      remaining: first(budgetInfo, "dailyPointsRemaining", "remaining", "remainingPoints"),
    }};
  } catch (e) { return { error: (e as Error).message }; }
}

export async function wwSearch(params: SearchParams, cfg: WWConfig): Promise<unknown> {
  try {
    const ep = makeEndpoints(cfg.tld);
    const jwt = await getJwt(cfg, ep);
    const query = params.query;
    const limit = params.limit ?? 10;
    if (!query) return { error: "query is required" };
    const results = await apiGet(ep.food_search, jwt, cfg, ep, { query, hitsPerPage: limit, page: 0 }) as Record<string, unknown>;
    const items = (results.hits ?? results.items ?? (Array.isArray(results) ? results : [])) as Array<Record<string, unknown>>;
    const foods = items.map(item => ({
      food_id: item._id ?? item.id ?? "",
      version_id: item.versionId ?? "",
      name: item.name ?? "Unknown",
      points: item.smartPoints ?? item.points ?? null,
      is_zero_points: item.isZeroPoints ?? false,
      source_type: item.sourceType ?? "",
      portions: ((item.portions ?? []) as Array<Record<string, unknown>>).map(p => ({
        portion_id: p._id ?? "",
        size: p.size ?? "",
        name: p.name ?? "",
      })),
    }));
    return { query, count: foods.length, results: foods };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function wwLog(params: LogParams, cfg: WWConfig): Promise<unknown> {
  try {
    const ep = makeEndpoints(cfg.tld);
    const jwt = await getJwt(cfg, ep);
    const targetDate = params.date ?? localDateString();
    const mealType = params.meal_type ?? "snacks";
    const item = {
      _id: params.food_id,
      sourceType: params.source_type ?? "WWFOOD",
      timeOfDay: MEAL_MAP[mealType] ?? "anytime",
      portionSize: params.portion_size ?? 1.0,
      versionId: params.version_id,
      portionId: params.portion_id,
    };
    const result = await apiPost(ep.tracked_foods.replace("{date}", targetDate), jwt, cfg, ep, [item]) as Record<string, unknown>;
    const errors = result.errors;
    if (errors) return { status: "warning", message: `Logged with warnings: ${JSON.stringify(errors)}`, date: targetDate, meal: mealType };
    return { status: "ok", message: `Logged to ${mealType} on ${targetDate}`, date: targetDate, meal: mealType };
  } catch (e) { return { error: (e as Error).message }; }
}

export function wwPoints(params: PointsParams): unknown {
  const pts = calculateSmartPoints(
    params.calories, params.saturated_fat,
    params.sugar, params.protein,
  );
  return { smart_points: pts, inputs: { calories: params.calories, saturated_fat: params.saturated_fat, sugar: params.sugar, protein: params.protein } };
}

export async function wwBudget(params: BudgetParams, cfg: WWConfig): Promise<unknown> {
  try {
    const ep = makeEndpoints(cfg.tld);
    const jwt = await getJwt(cfg, ep);
    const targetDate = params.date ?? localDateString();
    const data = await apiGet(ep.my_day.replace("{date}", targetDate), jwt, cfg, ep) as Record<string, unknown>;
    const today = (data.today ?? {}) as Record<string, unknown>;
    const b = (today.pointsDetails ?? today.budget ?? {}) as Record<string, unknown>;
    if (!Object.keys(b).length) return { date: targetDate, error: "No budget data found" };
    const result: Record<string, unknown> = {
      date: targetDate,
      daily_target: first(b, "dailyPointTarget", "daily", "dailyPoints", "dailyBudget"),
      used: first(b, "dailyPointsUsed", "used", "pointsUsed"),
      remaining: first(b, "dailyPointsRemaining", "remaining", "remainingPoints"),
    };
    const weekly = first(b, "weeklyPointAllowance", "weeklyAllowance", "weekly");
    if (weekly !== undefined) result.weekly_allowance = weekly;
    const weeklyUsed = first(b, "weeklyPointAllowanceUsed", "weeklyAllowanceUsed", "weeklyUsed");
    if (weeklyUsed !== undefined) result.weekly_used = weeklyUsed;
    const weeklyRem = first(b, "weeklyPointAllowanceRemaining");
    if (weeklyRem !== undefined) result.weekly_remaining = weeklyRem;
    const rollover = first(b, "dailyRolloverPointsEarned", "rollover", "rolledOver");
    if (rollover !== undefined) result.rollover = rollover;
    return result;
  } catch (e) { return { error: (e as Error).message }; }
}

export async function wwQuickAdd(params: QuickAddParams, cfg: WWConfig): Promise<unknown> {
  try {
    const ep = makeEndpoints(cfg.tld);
    const jwt = await getJwt(cfg, ep);
    const targetDate = params.date ?? localDateString();
    const mealType = params.meal_type ?? "snacks";
    const points = params.points;
    const item = { meal: mealType, isQuickAdd: true, points, name: params.name ?? "Quick Add", timeOfDay: MEAL_MAP[mealType] ?? "anytime" };
    const result = await apiPost(ep.tracked_foods.replace("{date}", targetDate), jwt, cfg, ep, [item]) as Record<string, unknown>;
    const errors = result.errors;
    if (errors) return { status: "warning", message: `Quick-added with warnings: ${JSON.stringify(errors)}`, date: targetDate, meal: mealType, points };
    return { status: "ok", message: `Quick-added ${points} pts to ${mealType} on ${targetDate}`, date: targetDate, meal: mealType, points };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function wwDelete(params: DeleteParams, cfg: WWConfig): Promise<unknown> {
  try {
    const ep = makeEndpoints(cfg.tld);
    const jwt = await getJwt(cfg, ep);
    const targetDate = params.date ?? localDateString();
    const trackingId = params.tracking_id;
    if (!trackingId) return { error: "tracking_id is required" };
    const listUrl = ep.tracked_foods_v3.replace("{date}", targetDate);
    const entries = await apiGet(listUrl, jwt, cfg, ep) as Array<Record<string, unknown>>;
    // Check if this is a meal (mealId) — collect all components
    const mealComponents = entries.filter(e => String(e.mealId ?? "") === trackingId);
    if (mealComponents.length > 0) {
      // Delete each meal component individually via item endpoint
      for (const e of mealComponents) {
        await deleteTrackedItem(targetDate, String(e.entryId ?? e._id ?? ""), jwt, cfg, ep);
      }
    } else {
      const entry = entries.find(e => String(e._id ?? "") === trackingId || String(e.entryId ?? "") === trackingId);
      if (!entry) return { error: `Entry ${trackingId} not found on ${targetDate}` };
      const itemId = String(entry.entryId ?? entry._id ?? "");
      if (!itemId) return { error: "Entry has no id — cannot delete" };
      await deleteTrackedItem(targetDate, itemId, jwt, cfg, ep);
    }
    return { status: "ok", message: `Deleted tracked item ${trackingId} from ${targetDate}`, date: targetDate, tracking_id: trackingId };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function wwSearchMeals(params: SearchMealsParams, cfg: WWConfig): Promise<unknown> {
  try {
    const ep = makeEndpoints(cfg.tld);
    const jwt = await getJwt(cfg, ep);
    const query = (params.query ?? "").toLowerCase();
    const typeFilter = params.type ?? "all";
    const results: unknown[] = [];
    const fetches: Array<[string, string]> = [];
    if (typeFilter === "all" || typeFilter === "meal") fetches.push([ep.custom_meals + "?limit=20", "MEMBERMEAL"]);
    if (typeFilter === "all" || typeFilter === "recipe") fetches.push([ep.custom_recipes + "?limit=20", "MEMBERRECIPE"]);
    if (typeFilter === "all" || typeFilter === "food") fetches.push([ep.custom_foods_list + "?limit=20", "MEMBERFOOD"]);
    for (const [url, sourceType] of fetches) {
      const items = await apiGet(url, jwt, cfg, ep) as Array<Record<string, unknown>>;
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const name = String(item.name ?? item._displayName ?? "");
        if (query && !name.toLowerCase().includes(query)) continue;
        results.push({
          meal_id: String(item._id ?? ""),
          version_id: String(item.versionId ?? ""),
          name,
          type: sourceType,
          points: item.points ?? item.pointsPrecise ?? 0,
        });
      }
    }
    return { count: results.length, results };
  } catch (e) { return { error: (e as Error).message }; }
}

export async function wwLogMeal(params: LogMealParams, cfg: WWConfig): Promise<unknown> {
  try {
    const ep = makeEndpoints(cfg.tld);
    const jwt = await getJwt(cfg, ep);
    const mealId = params.meal_id;
    if (!mealId) return { error: "meal_id is required" };
    const type = params.type ?? "meal";
    const timeOfDay = params.meal_type ?? "morning";
    const targetDate = params.date ?? localDateString();
    // Fetch meal/recipe/food definition
    const detailUrl = type === "meal" ? ep.custom_meals + "/" + mealId
      : type === "recipe" ? ep.custom_recipes + "/" + mealId
      : ep.custom_foods_list + "/" + mealId;
    const detail = await apiGet(detailUrl, jwt, cfg, ep) as Record<string, unknown>;
    const versionId = String(detail.versionId ?? "");
    if (type === "meal") {
      // Log each component food with mealId/mealVersionId
      const items = (detail.items ?? []) as Array<Record<string, unknown>>;
      const body = items.map(item => ({
        _id: String(item.itemId ?? ""),
        versionId: String(item.itemVersionId ?? ""),
        portionId: String(item.portionId ?? ""),
        portionSize: item.quantity ?? 1,
        sourceType: String(item.itemType ?? "WWFOOD"),
        timeOfDay,
        mealId,
        mealVersionId: versionId,
      }));
      await apiPost(ep.tracked_foods.replace("{date}", targetDate), jwt, cfg, ep, body);
      return { status: "ok", message: `Logged meal "${detail.name}" to ${targetDate} ${timeOfDay}`, date: targetDate, points: detail.points ?? detail.pointsPrecise };
    } else {
      // Recipe or custom food — log as single item
      const item = {
        _id: mealId,
        versionId,
        sourceType: type === "recipe" ? "MEMBERRECIPE" : "MEMBERFOOD",
        portionSize: 1,
        timeOfDay,
      };
      await apiPost(ep.tracked_foods.replace("{date}", targetDate), jwt, cfg, ep, [item]);
      return { status: "ok", message: `Logged ${type} "${detail.name}" to ${targetDate} ${timeOfDay}`, date: targetDate, points: detail.points ?? detail.pointsPrecise };
    }
  } catch (e) { return { error: (e as Error).message }; }
}
