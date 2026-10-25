/**
 * index.ts — octo-mcp entry point.
 *
 * Env:
 *   OCTO_MCP_PORT              listen port (default 18793)
 *   OCTO_MCP_ALLOWED_HOSTS     comma-separated Host header allowlist
 *   OCTO_MCP_AUTHKIT_ISSUER    WorkOS AuthKit issuer, e.g. https://example.authkit.app (required)
 *   OCTO_MCP_RESOURCE          public resource URL (default https://octo.tail498490.ts.net/mcp)
 *   OCTO_MCP_ALLOWED_SUBJECTS  comma-separated WorkOS user ids allowed in (empty = nobody)
 *
 * Without an issuer the server refuses to start: it never serves /mcp unauthenticated.
 */

import { createMcpHttpServer } from "./server.js";

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

const server = createMcpHttpServer({
  allowedHosts: ALLOWED_HOSTS,
  auth: { issuer: ISSUER, resource: RESOURCE, allowedSubjects: SUBJECTS },
  log,
});
server.listen(PORT, "127.0.0.1", () => {
  log(`listening on 127.0.0.1:${PORT}/mcp`);
  log(`resource ${RESOURCE}, issuer ${ISSUER}, ${SUBJECTS.length} allowed subject(s)`);
  log(`allowed hosts: ${ALLOWED_HOSTS.join(", ")}`);
});
server.on("error", (e) => {
  log(`server error: ${e}`);
  process.exit(1);
});
