/**
 * index.ts — Main entry point for webhook-proxy.
 *
 * Loads config, checks required env vars, and starts the proxy server
 * (see server.ts for request handling).
 */

import { loadConfig, log, requireEnv, PORT } from "./config.js";
import { createProxyServer } from "./server.js";

const config = loadConfig();

// Eagerly validate that required env vars exist at startup
const openclawBearer = requireEnv(config.openclaw_bearer_env);
for (const route of config.routes) {
  if (route.auth.type !== "none") {
    const val = process.env[route.auth.secret_env];
    if (!val) {
      log(`WARN: env var ${route.auth.secret_env} not set for route ${route.path}`);
    }
  }
  if (route.filter && route.filter.type !== "github-issues") {
    log(`WARN: unknown filter type on route ${route.path}; all events will be dropped`);
  }
}

const host = config.bind_host ?? "127.0.0.1";
const server = createProxyServer(config, { bearer: openclawBearer });

server.listen(PORT, host, () => {
  log(`listening on ${host}:${PORT}`);
  log(`proxying to ${config.openclaw_url}`);
  log(
    `routes: ${config.routes
      .map((r) => `${r.path} [${r.auth.type}${r.filter ? `, filter=${r.filter.type}` : ""}]`)
      .join(", ")}`,
  );
});

server.on("error", (e) => {
  log(`server error: ${e}`);
  process.exit(1);
});
