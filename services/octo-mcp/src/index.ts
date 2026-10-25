/**
 * index.ts — octo-mcp entry point.
 *
 * Env:
 *   OCTO_MCP_PORT              listen port (default 18793)
 *   OCTO_MCP_ALLOWED_HOSTS     comma-separated Host header allowlist
 *   OCTO_MCP_AUTHKIT_ISSUER    WorkOS AuthKit issuer, e.g. https://example.authkit.app (required)
 *   OCTO_MCP_RESOURCE          public resource URL (default https://octo.tail498490.ts.net/mcp)
 *   OCTO_MCP_ALLOWED_SUBJECTS  comma-separated WorkOS user ids allowed in (empty = nobody)
 *   OCTO_MCP_DEVICE_DIR        paired-device identity and token (default ~/.openclaw/secrets/octo-mcp)
 *   OCTO_MCP_GATEWAY_URL       OpenClaw Gateway WebSocket (default ws://127.0.0.1:18789)
 *   OCTO_MCP_AGENT             agent behind the house and calendar tools (default "external")
 *
 * Everything but ping needs the service to be paired (see pair.ts).
 *
 * Without an issuer the server refuses to start: it never serves /mcp unauthenticated.
 */

import os from "node:os";
import path from "node:path";
import { DeviceStore, OctoGateway } from "./octo-gateway.js";
import { createMcpHttpServer } from "./server.js";
import type { OctoBackend } from "./tools.js";

const PORT = parseInt(process.env["OCTO_MCP_PORT"] ?? "18793", 10);
const list = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const ALLOWED_HOSTS = list(
  process.env["OCTO_MCP_ALLOWED_HOSTS"] ??
    `127.0.0.1:${PORT},localhost:${PORT},octo.tail498490.ts.net`,
);
const ISSUER = (process.env["OCTO_MCP_AUTHKIT_ISSUER"] ?? "").replace(/\/+$/, "");
const RESOURCE = process.env["OCTO_MCP_RESOURCE"] ?? "https://octo.tail498490.ts.net/mcp";
const SUBJECTS = list(process.env["OCTO_MCP_ALLOWED_SUBJECTS"]);

function log(message: string): void {
  console.log(`[octo-mcp] ${new Date().toISOString()} ${message}`);
}

if (!/^https:\/\/[^/]+$/.test(ISSUER)) {
  log("OCTO_MCP_AUTHKIT_ISSUER must be set to the AuthKit origin (https://…); refusing to start without auth");
  process.exit(1);
}

const DEVICE_DIR = process.env["OCTO_MCP_DEVICE_DIR"] ?? path.join(os.homedir(), ".openclaw/secrets/octo-mcp");
const GATEWAY_URL = process.env["OCTO_MCP_GATEWAY_URL"] ?? "ws://127.0.0.1:18789";
const AGENT = process.env["OCTO_MCP_AGENT"] ?? "external";

const store = new DeviceStore(DEVICE_DIR);
let octo: OctoBackend | undefined;
if (store.isPaired()) {
  const gateway = new OctoGateway({ url: GATEWAY_URL, store, log }, AGENT, `agent:${AGENT}:mcp`);
  const destinations = store.loadDestinations();
  octo = {
    ask: (prompt) => gateway.ask(prompt),
    send: async (name, message) => {
      const dest = destinations[name];
      if (!dest) return { ok: false, text: `${name} isn't somewhere Octo can send.` };
      log(`send_message to ${name} (${dest.channel})`);
      return gateway.send(dest, message);
    },
    destinations: Object.fromEntries(Object.entries(destinations).map(([n, d]) => [n, d.channel])),
  };
} else {
  log(`not paired with the Gateway (${DEVICE_DIR}); only ping is offered. Run dist/pair.js to pair.`);
}

const server = createMcpHttpServer({
  allowedHosts: ALLOWED_HOSTS,
  auth: { issuer: ISSUER, resource: RESOURCE, allowedSubjects: SUBJECTS },
  log,
  ...(octo ? { octo } : {}),
});
server.listen(PORT, "127.0.0.1", () => {
  log(`listening on 127.0.0.1:${PORT}/mcp`);
  log(`resource ${RESOURCE}, issuer ${ISSUER}, ${SUBJECTS.length} allowed subject(s)`);
  log(octo ? `tools → agent "${AGENT}" via ${GATEWAY_URL}; destinations: ${Object.keys(octo.destinations).join(", ") || "none"}` : "only ping (not paired)");
  log(`allowed hosts: ${ALLOWED_HOSTS.join(", ")}`);
});
server.on("error", (e) => {
  log(`server error: ${e}`);
  process.exit(1);
});
