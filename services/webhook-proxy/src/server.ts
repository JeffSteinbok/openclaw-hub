/**
 * server.ts — Request handling for webhook-proxy.
 *
 * Matches the request path to a route, enforces method / size / lockout limits,
 * validates auth (HMAC or bearer), applies the route's event filter, and
 * forwards what's left to OpenClaw with the hooks bearer token injected.
 */

import http from "node:http";
import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import { DEFAULT_MAX_BODY_BYTES, log } from "./config.js";
import type { Config } from "./config.js";
import { BodyTooLargeError, readBody, validateAuth } from "./auth.js";
import { applyFilter } from "./filter.js";
import { AuthFailureLimiter, DEFAULT_LIMITER } from "./limiter.js";
import { forwardToOpenclaw } from "./proxy.js";

export interface ProxyDeps {
  /** OpenClaw hooks bearer token */
  bearer: string;
  forward?: typeof forwardToOpenclaw;
  limiter?: AuthFailureLimiter;
}

/**
 * Client identity for the lockout. Tailscale Funnel connects from loopback and
 * sets X-Forwarded-For; LAN senders connect directly.
 */
export function clientKey(req: IncomingMessage): string {
  const remote = req.socket.remoteAddress ?? "unknown";
  const isLoopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  const xff = req.headers["x-forwarded-for"];
  const forwarded = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
  return isLoopback && forwarded ? forwarded : remote;
}

function reply(res: http.ServerResponse, status: number, text: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "text/plain", ...headers });
  res.end(text);
}

export function createProxyServer(config: Config, deps: ProxyDeps): http.Server {
  const forward = deps.forward ?? forwardToOpenclaw;
  const maxBody = config.max_body_bytes ?? DEFAULT_MAX_BODY_BYTES;
  const limits = config.auth_failure_limit ?? {};
  const limiter =
    deps.limiter ??
    new AuthFailureLimiter({
      maxFailures: limits.max_failures ?? DEFAULT_LIMITER.maxFailures,
      windowMs: limits.window_ms ?? DEFAULT_LIMITER.windowMs,
      lockoutMs: limits.lockout_ms ?? DEFAULT_LIMITER.lockoutMs,
    });

  return http.createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const path = new URL(req.url ?? "/", "http://localhost").pathname;

    // Exact path match only. Tailscale strips the Funnel mount prefix, so the
    // Funnel config must mount /hooksproxy (not each route) for paths to survive.
    const route = config.routes.find((r) => r.path === path);
    if (!route) {
      log(`404 no route for ${method} ${path}`);
      reply(res, 404, "Not found");
      return;
    }

    if (method !== "POST") {
      reply(res, 405, "Method not allowed", { allow: "POST" });
      return;
    }

    const client = clientKey(req);
    const retryMs = limiter.retryAfterMs(client);
    if (retryMs > 0) {
      log(`429 ${client} locked out for ${Math.ceil(retryMs / 1000)}s (${path})`);
      reply(res, 429, "Too many requests", { "retry-after": String(Math.ceil(retryMs / 1000)) });
      return;
    }

    const reqId = crypto.randomBytes(4).toString("hex");
    const ua = req.headers["user-agent"] ?? "unknown";
    const event = req.headers["x-github-event"] ?? "-";
    const delivery = req.headers["x-github-delivery"] ?? "-";
    log(`[${reqId}] → ${method} ${path} event=${event} delivery=${delivery} ua=${ua}`);

    let body: Buffer;
    try {
      body = await readBody(req, maxBody);
    } catch (e) {
      if (e instanceof BodyTooLargeError) {
        log(`[${reqId}] 413 body over ${maxBody} bytes`);
        reply(res, 413, "Payload too large", { connection: "close" });
        req.destroy();
        return;
      }
      log(`[${reqId}] ERROR reading body: ${e}`);
      reply(res, 400, "Bad request");
      return;
    }

    log(`[${reqId}] body ${body.length} bytes, auth type=${route.auth.type}`);

    const authResult = validateAuth(route.auth, req.headers, body);
    if (!authResult.ok) {
      limiter.recordFailure(client);
      log(`[${reqId}] 401 auth failed: ${authResult.reason}`);
      reply(res, 401, "Unauthorized");
      return;
    }
    limiter.recordSuccess(client);
    log(`[${reqId}] auth ok`);

    const decision = applyFilter(route.filter, req.headers, body);
    if (!decision.forward) {
      log(`[${reqId}] 204 dropped by filter: ${decision.reason}`);
      res.writeHead(204);
      res.end();
      return;
    }

    const forwardPath = route.forward_path ?? route.path;
    try {
      const result = await forward(config.openclaw_url, deps.bearer, forwardPath, method, req.headers, body);
      log(`[${reqId}] ← ${result.status} from openclaw (forwarded to ${forwardPath})`);
      if (result.status >= 400) {
        log(`[${reqId}] openclaw response body: ${result.body.slice(0, 500)}`);
      }
      res.writeHead(result.status, { "content-type": "application/json" });
      res.end(result.body);
    } catch (e) {
      log(`[${reqId}] ERROR forwarding to openclaw at ${forwardPath}: ${e}`);
      reply(res, 502, "Bad gateway");
    }
  });
}
