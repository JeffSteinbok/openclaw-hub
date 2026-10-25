/**
 * index.ts — mcp-bridge entry point.
 *
 * Env (keep private values in an env file, never in a repo):
 *   MCP_BRIDGE_TOOLS            path to the tool definitions JSON (required; see config.ts)
 *   MCP_BRIDGE_RESOURCE         public MCP URL, e.g. https://<host>/mcp (required)
 *   MCP_BRIDGE_ISSUER           OAuth authorization server issuer, exactly as it appears in tokens (required)
 *   MCP_BRIDGE_JWKS_URL         signing keys URL (default: jwks_uri from the issuer's metadata)
 *   MCP_BRIDGE_ALLOWED_SUBJECTS comma-separated token `sub` values allowed in (empty = nobody)
 *   MCP_BRIDGE_DEVICE_DIR       paired-device identity, token and destinations (default ~/.openclaw/secrets/mcp-bridge)
 *   MCP_BRIDGE_GATEWAY_URL      OpenClaw Gateway WebSocket (default ws://127.0.0.1:18789)
 *   MCP_BRIDGE_ALLOWED_HOSTS    Host header allowlist (default: loopback + the resource's host)
 *   MCP_BRIDGE_PORT             listen port (default 18793)
 *
 * Fails closed: without a resource, an https issuer, signing keys or a valid
 * tools file it refuses to start; it never serves /mcp unauthenticated.
 */

import os from "node:os";
import path from "node:path";
import { createRemoteJWKSet } from "jose";
import { loadConfig, type BridgeConfig } from "./config.js";
import { DeviceStore, OpenClawGateway } from "./gateway.js";
import { createMcpHttpServer } from "./server.js";
import type { BridgeBackend } from "./tools.js";

const env = (name: string) => process.env[`MCP_BRIDGE_${name}`] ?? "";
const list = (value: string) =>
  value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function log(message: string): void {
  console.log(`[mcp-bridge] ${new Date().toISOString()} ${message}`);
}

function fatal(message: string): never {
  log(`${message}; refusing to start`);
  process.exit(1);
}

const PORT = parseInt(env("PORT") || "18793", 10);
const RESOURCE = env("RESOURCE");
const ISSUER = env("ISSUER");
const SUBJECTS = list(env("ALLOWED_SUBJECTS"));
const DEVICE_DIR = env("DEVICE_DIR") || path.join(os.homedir(), ".openclaw/secrets/mcp-bridge");
const GATEWAY_URL = env("GATEWAY_URL") || "ws://127.0.0.1:18789";

if (!/^https:\/\/[^/]+\/.*$/.test(RESOURCE)) fatal("MCP_BRIDGE_RESOURCE must be the public MCP URL (https://…/mcp)");
if (!/^https:\/\/[^/]+/.test(ISSUER)) fatal("MCP_BRIDGE_ISSUER must be the OAuth issuer (https://…)");
if (!env("TOOLS")) fatal("MCP_BRIDGE_TOOLS must point at the tool definitions file");

let config: BridgeConfig;
try {
  config = loadConfig(env("TOOLS"));
} catch (e) {
  fatal(e instanceof Error ? e.message : String(e));
}

const ALLOWED_HOSTS = list(env("ALLOWED_HOSTS") || `127.0.0.1:${PORT},localhost:${PORT},${new URL(RESOURCE).host}`);

/** The signing keys URL: configured, or jwks_uri from the issuer's published metadata. */
async function jwksUrl(): Promise<string> {
  if (env("JWKS_URL")) return env("JWKS_URL");
  const base = ISSUER.replace(/\/+$/, "");
  for (const wellKnown of ["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"]) {
    try {
      const res = await fetch(base + wellKnown);
      if (res.ok) {
        const meta = (await res.json()) as { jwks_uri?: string };
        if (meta.jwks_uri) return meta.jwks_uri;
      }
    } catch {
      // try the next document
    }
  }
  return fatal(`couldn't find jwks_uri in the issuer's metadata; set MCP_BRIDGE_JWKS_URL`);
}

const store = new DeviceStore(DEVICE_DIR);
let backend: BridgeBackend | undefined;
if (store.isPaired()) {
  const gateway = new OpenClawGateway({ url: GATEWAY_URL, store, log });
  const destinations = store.loadDestinations();
  backend = {
    invoke: (agent, tool, args) => gateway.invoke(agent, tool, args),
    ask: (agent, prompt) => gateway.ask(agent, prompt),
    send: async (name, message) => {
      const dest = destinations[name];
      if (!dest) return { ok: false, text: `${name} isn't a configured destination.` };
      log(`send to ${name} (${dest.channel})`);
      return gateway.send(dest, message);
    },
    destinations: Object.fromEntries(Object.entries(destinations).map(([n, d]) => [n, d.channel])),
  };
} else {
  log(`not paired with the Gateway (${DEVICE_DIR}); only ping is offered. Run dist/pair.js to pair.`);
}

const keys = createRemoteJWKSet(new URL(await jwksUrl()));
const server = createMcpHttpServer({
  allowedHosts: ALLOWED_HOSTS,
  auth: { issuer: ISSUER, resource: RESOURCE, allowedSubjects: SUBJECTS, keys },
  config,
  log,
  ...(backend ? { backend } : {}),
});
server.listen(PORT, "127.0.0.1", () => {
  log(`listening on 127.0.0.1:${PORT}/mcp as "${config.name}"`);
  log(`${SUBJECTS.length} allowed subject(s); tools: ${backend ? config.tools.map((t) => t.name).join(", ") : "ping only (not paired)"}`);
  if (backend) log(`destinations: ${Object.keys(backend.destinations).join(", ") || "none"}`);
});
server.on("error", (e) => {
  log(`server error: ${e}`);
  process.exit(1);
});
