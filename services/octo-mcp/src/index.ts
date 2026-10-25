/**
 * index.ts — octo-mcp entry point.
 *
 * Env:
 *   OCTO_MCP_PORT           listen port (default 18793)
 *   OCTO_MCP_ALLOWED_HOSTS  comma-separated Host header allowlist
 */

import { createMcpHttpServer } from "./server.js";

const PORT = parseInt(process.env["OCTO_MCP_PORT"] ?? "18793", 10);
const ALLOWED_HOSTS = (
  process.env["OCTO_MCP_ALLOWED_HOSTS"] ??
  `127.0.0.1:${PORT},localhost:${PORT},<funnel-host>:8443,<funnel-host>`
)
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

function log(message: string): void {
  console.log(`[octo-mcp] ${new Date().toISOString()} ${message}`);
}

const server = createMcpHttpServer({ allowedHosts: ALLOWED_HOSTS, log });
server.listen(PORT, "127.0.0.1", () => {
  log(`listening on 127.0.0.1:${PORT}/mcp`);
  log(`allowed hosts: ${ALLOWED_HOSTS.join(", ")}`);
});
server.on("error", (e) => {
  log(`server error: ${e}`);
  process.exit(1);
});
