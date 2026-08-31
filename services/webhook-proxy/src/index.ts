/**
 * index.ts — Main entry point for webhook-proxy.
 *
 * Listens for inbound webhook requests, matches them against configured routes,
 * validates auth (HMAC or bearer), and forwards to OpenClaw with the correct
 * bearer token injected.
 */

import http from "node:http";
import crypto from "node:crypto";
import { loadConfig, log, requireEnv, PORT } from "./config.js";
import { readBody, validateAuth } from "./auth.js";
import { forwardToOpenclaw } from "./proxy.js";

const config = loadConfig();

// Eagerly validate that required env vars exist at startup
const openaclawBearer = requireEnv(config.openclaw_bearer_env);
for (const route of config.routes) {
  if (route.auth.type !== "none") {
    const val = process.env[route.auth.secret_env];
    if (!val) {
      log(`WARN: env var ${route.auth.secret_env} not set for route ${route.path}`);
    }
  }
}

const server = http.createServer(async (req, res) => {
  const method = req.method ?? "POST";
  const path = req.url ?? "/";

  // Tailscale strips the mount path prefix before forwarding, so requests
  // arrive as POST / even when the external URL was /hooksproxy/github-issues.
  // Match on / as well as the configured path.
  const route = config.routes.find((r) => r.path === path || path === "/");

  if (!route) {
    log(`404 no route for ${method} ${path}`);
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
    return;
  }

  const reqId = crypto.randomBytes(4).toString("hex");
  const ua = req.headers["user-agent"] ?? "unknown";
  const event = req.headers["x-github-event"] ?? "-";
  const delivery = req.headers["x-github-delivery"] ?? "-";
  log(`[${reqId}] → ${method} ${path} event=${event} delivery=${delivery} ua=${ua}`);

  let body: Buffer;
  try {
    body = await readBody(req);
  } catch (e) {
    log(`[${reqId}] ERROR reading body: ${e}`);
    res.writeHead(400, { "content-type": "text/plain" });
    res.end("Bad request");
    return;
  }

  log(`[${reqId}] body ${body.length} bytes, auth type=${route.auth.type}`);

  const authResult = validateAuth(route.auth, req.headers, body);

  if (!authResult.ok) {
    log(`[${reqId}] 401 auth failed: ${authResult.reason}`);
    res.writeHead(401, { "content-type": "text/plain" });
    res.end("Unauthorized");
    return;
  }

  log(`[${reqId}] auth ok`);

  const forwardPath = route.forward_path ?? route.path;

  try {
    const result = await forwardToOpenclaw(
      config.openclaw_url,
      openaclawBearer,
      forwardPath,
      method,
      req.headers,
      body,
    );

    log(`[${reqId}] ← ${result.status} from openclaw (forwarded to ${forwardPath})`);
    if (result.status >= 400) {
      log(`[${reqId}] openclaw response body: ${result.body.slice(0, 500)}`);
    }

    res.writeHead(result.status, { "content-type": "application/json" });
    res.end(result.body);
  } catch (e) {
    log(`[${reqId}] ERROR forwarding to openclaw at ${forwardPath}: ${e}`);
    res.writeHead(502, { "content-type": "text/plain" });
    res.end("Bad gateway");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  log(`listening on 127.0.0.1:${PORT}`);
  log(`proxying to ${config.openclaw_url}`);
  log(`routes: ${config.routes.map((r) => `${r.path} [${r.auth.type}]`).join(", ")}`);
});

server.on("error", (e) => {
  log(`server error: ${e}`);
  process.exit(1);
});
