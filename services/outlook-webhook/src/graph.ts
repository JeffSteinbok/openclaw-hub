/**
 * MS Graph API client — token refresh, message fetch, subscription CRUD.
 */

import https from "node:https";
import { log, GRAPH_BASE, TOKEN_URL } from "./config.js";

// ── Types ────────────────────────────────────────────────────

export interface GraphConfig {
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
}

export interface GraphMessage {
  id: string;
  subject?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  receivedDateTime?: string;
  bodyPreview?: string;
  body?: { content?: string; contentType?: string };
  hasAttachments?: boolean;
  internetMessageHeaders?: Array<{ name: string; value: string }>;
}

export interface GraphSubscription {
  id: string;
  expirationDateTime: string;
  resource: string;
  changeType: string;
  notificationUrl: string;
  clientState: string;
}

// ── HTTP helpers ─────────────────────────────────────────────

function httpRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method, headers, timeout: 30_000 },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: data }),
        );
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("request timeout"));
    });
    if (body) req.write(body);
    req.end();
  });
}

// ── Token management ─────────────────────────────────────────

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

export async function getAccessToken(config: GraphConfig): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.accessToken;
  }

  const params: Record<string, string> = {
    client_id: config.clientId,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token",
    scope: "Mail.Read offline_access",
  };
  // Public-client (PKCE) registrations have no secret; only send it when present
  if (config.clientSecret) params.client_secret = config.clientSecret;
  const body = new URLSearchParams(params).toString();

  const resp = await httpRequest(
    "POST",
    TOKEN_URL,
    { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  );

  if (resp.status !== 200) {
    throw new Error(`Token refresh failed (${resp.status}): ${resp.body.slice(0, 200)}`);
  }

  const json = JSON.parse(resp.body) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!json.access_token) {
    throw new Error(
      `Token refresh error: ${json.error ?? "unknown"} — ${json.error_description ?? ""}`,
    );
  }

  tokenCache = {
    accessToken: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600) * 1000,
  };

  log("access token refreshed");
  return tokenCache.accessToken;
}

/** Invalidate cached token (e.g. after a 401) */
export function invalidateToken(): void {
  tokenCache = null;
}

// ── Message fetch ─────────────────────────────────────────────

export async function fetchMessage(
  config: GraphConfig,
  messageId: string,
): Promise<GraphMessage> {
  const token = await getAccessToken(config);
  const select =
    "id,subject,from,receivedDateTime,bodyPreview,body,hasAttachments,internetMessageHeaders";
  const url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}?$select=${select}`;

  const resp = await httpRequest("GET", url, {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  });

  if (resp.status === 401) {
    invalidateToken();
    throw new Error(`Graph 401 fetching message ${messageId} — token invalidated, will retry`);
  }

  if (resp.status !== 200) {
    throw new Error(
      `Graph message fetch failed (${resp.status}): ${resp.body.slice(0, 200)}`,
    );
  }

  return JSON.parse(resp.body) as GraphMessage;
}

// ── Subscription CRUD ─────────────────────────────────────────

export async function createSubscription(
  config: GraphConfig,
  opts: {
    notificationUrl: string;
    clientState: string;
    expirationDateTime: string;
  },
): Promise<GraphSubscription> {
  const token = await getAccessToken(config);

  const body = JSON.stringify({
    changeType: "created",
    notificationUrl: opts.notificationUrl,
    resource: "me/mailFolders/inbox/messages",
    expirationDateTime: opts.expirationDateTime,
    clientState: opts.clientState,
  });

  const resp = await httpRequest(
    "POST",
    `${GRAPH_BASE}/subscriptions`,
    {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body,
  );

  if (resp.status === 401) {
    invalidateToken();
    throw new Error("Graph 401 creating subscription — token invalidated");
  }

  if (resp.status !== 201) {
    throw new Error(
      `Subscription creation failed (${resp.status}): ${resp.body.slice(0, 300)}`,
    );
  }

  return JSON.parse(resp.body) as GraphSubscription;
}

export async function renewSubscription(
  config: GraphConfig,
  subscriptionId: string,
  expirationDateTime: string,
): Promise<GraphSubscription> {
  const token = await getAccessToken(config);

  const body = JSON.stringify({ expirationDateTime });

  const resp = await httpRequest(
    "PATCH",
    `${GRAPH_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body,
  );

  if (resp.status === 401) {
    invalidateToken();
    throw new Error("Graph 401 renewing subscription — token invalidated");
  }

  if (resp.status !== 200) {
    throw new Error(
      `Subscription renewal failed (${resp.status}): ${resp.body.slice(0, 300)}`,
    );
  }

  return JSON.parse(resp.body) as GraphSubscription;
}

export async function deleteSubscription(
  config: GraphConfig,
  subscriptionId: string,
): Promise<void> {
  try {
    const token = await getAccessToken(config);
    await httpRequest(
      "DELETE",
      `${GRAPH_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}`,
      { Authorization: `Bearer ${token}` },
    );
    log(`subscription ${subscriptionId} deleted`);
  } catch (e) {
    log(`warning: failed to delete subscription: ${e}`);
  }
}
