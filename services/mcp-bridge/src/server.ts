/**
 * server.ts — HTTP server for the bridge's MCP endpoint.
 *
 * Streamable HTTP in stateless mode: every POST /mcp gets a fresh McpServer
 * and transport, so no session state lives in the process.
 *
 * Every /mcp request needs an OAuth access token from the configured
 * authorization server (see auth.ts). The server publishes its protected
 * resource metadata so clients can find it; tokens are checked before the
 * request body is read.
 *
 * Tools come from the bridge config (config.ts, tools.ts); all but `ping` need
 * the service to be paired with the Gateway (gateway.ts).
 */

import { isIP } from "node:net";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { authenticate, challenge, protectedResourceMetadata, type AuthConfig } from "./auth.js";
import type { BridgeConfig } from "./config.js";
import { registerTools, type BridgeBackend } from "./tools.js";

export const MCP_PATH = "/mcp";
const PRM_PATHS = new Set(["/.well-known/oauth-protected-resource", `/.well-known/oauth-protected-resource${MCP_PATH}`]);
const AS_METADATA_PATH = "/.well-known/oauth-authorization-server";
const AS_METADATA_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export interface ServerOptions {
  /** Host header values accepted (DNS rebinding guard). Empty = accept any. */
  allowedHosts: string[];
  /** Mount path restored for a listener on a private Tailscale Unix socket. */
  proxyMount?: string;
  auth: AuthConfig;
  maxBodyBytes?: number;
  /** Fetch for the authorization-server metadata fallback (tests stub it). */
  fetch?: typeof fetch;
  log?: (message: string) => void;
  now?: () => Date;
  /** The tools to offer. */
  config: () => BridgeConfig;
  /** OpenClaw behind the tools; omitted when the bridge isn't paired (only `ping` is offered). */
  backend?: BridgeBackend;
}

export function buildMcpServer(config: BridgeConfig, now: () => Date = () => new Date(), backend?: BridgeBackend): McpServer {
  const server = new McpServer(
    { name: config.name, version: "0.3.3" },
    config.instructions ? { instructions: config.instructions } : undefined,
  );
  registerTools(server, config, now, backend);
  return server;
}

class BodyTooLargeError extends Error {}

function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        // Keep reading but drop the bytes: answering before the upload ends
        // can reset the connection before the client reads the 413.
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) {
        reject(new BodyTooLargeError());
        return;
      }
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function jsonRpcError(res: ServerResponse, status: number, code: number, message: string): void {
  sendJson(res, status, { jsonrpc: "2.0", error: { code, message }, id: null });
}

function callerOrigin(req: IncomingMessage): string {
  // Called only on a private Unix listener. Serve replaces X-Forwarded-For
  // with a single IP and sets its own Funnel flag.
  const address = req.headers["x-forwarded-for"];
  const funnel = req.headers["tailscale-funnel-request"];
  if (req.headers["x-forwarded-host"] && typeof address === "string" &&
      !address.includes("%") && isIP(address) && (funnel === undefined || funnel === "?1")) {
    return `ip=${address} via=${funnel === "?1" ? "funnel" : "tailnet"}`;
  }
  return "ip=- via=unknown";
}

export function createMcpHttpServer(options: ServerOptions): Server {
  const log = options.log ?? (() => {});
  const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const allowed = new Set(options.allowedHosts.map((h) => h.toLowerCase()));
  const fetchImpl = options.fetch ?? fetch;
  let asMetadata: { body: unknown; at: number } | null = null;

  // Compatibility fallback (WorkOS docs): clients that look for the
  // authorization server metadata on the resource origin get AuthKit's copy.
  async function authorizationServerMetadata(): Promise<unknown> {
    if (asMetadata && Date.now() - asMetadata.at < AS_METADATA_TTL_MS) {
      return asMetadata.body;
    }
    const res = await fetchImpl(`${options.auth.issuer}${AS_METADATA_PATH}`);
    if (!res.ok) {
      throw new Error(`AuthKit metadata ${res.status}`);
    }
    asMetadata = { body: await res.json(), at: Date.now() };
    return asMetadata.body;
  }

  return createServer(async (req, res) => {
    // A Funnel mount can forward /mcp as /mcp/; treat a trailing slash as the same path.
    const incomingPath = new URL(req.url ?? "/", "http://localhost").pathname;
    const path = ((options.proxyMount ?? "") + incomingPath).replace(/(.)\/+$/, "$1");
    // Serve uses localhost as the HTTP Host on Unix sockets and provides the
    // original host independently in its own forwarding header.
    const host = (options.proxyMount ? req.headers["x-forwarded-host"] : req.headers.host) ?? "";
    const hostName = typeof host === "string" ? host.toLowerCase() : "";
    const hostAllowed = allowed.size === 0 || allowed.has(hostName);
    const auth = hostAllowed && path === MCP_PATH && req.method === "POST"
      ? await authenticate(req.headers.authorization, options.auth)
      : undefined;
    const client = auth?.clientId?.replace(/[\s\x00-\x1f\x7f-\x9f]/g, encodeURIComponent) ?? "-";
    if (auth?.ok) {
      log(`signed-in POST /mcp ${options.proxyMount ? callerOrigin(req) : "ip=- via=unknown"} client=${client}`);
    } else {
      log(`→ ${req.method} ${path} client=${client} auth=${auth?.status ?? "-"}`);
    }

    if (!hostAllowed) {
      log(`421 host not allowed: ${hostName}`);
      sendJson(res, 421, { error: "misdirected request" });
      return;
    }
    if (req.method === "GET" && PRM_PATHS.has(path)) {
      sendJson(res, 200, protectedResourceMetadata(options.auth), { "cache-control": "max-age=300" });
      return;
    }
    if (req.method === "GET" && path === AS_METADATA_PATH) {
      try {
        sendJson(res, 200, await authorizationServerMetadata(), { "cache-control": "max-age=300" });
      } catch (e) {
        log(`authorization server metadata unavailable: ${e}`);
        sendJson(res, 502, { error: "authorization server metadata unavailable" });
      }
      return;
    }
    if (path !== MCP_PATH) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    if (!auth) {
      // Stateless mode has no standalone SSE stream or session to delete.
      res.writeHead(405, { allow: "POST" }).end();
      return;
    }

    if (!auth.ok) {
      const agent = req.headers["user-agent"];
      const directLoopback = !options.proxyMount && req.socket.remoteAddress === "127.0.0.1" &&
        req.headers["x-forwarded-for"] === undefined && req.headers["x-forwarded-host"] === undefined &&
        req.headers["tailscale-funnel-request"] === undefined;
      const smoke = directLoopback && auth.status === 401 && req.headers.authorization === undefined &&
        typeof agent === "string" && /^octo-healthcheck\/[a-f0-9]{32}$/.test(agent)
        ? ` smoke=${agent} route=/mcp source=loopback` : "";
      log(`${auth.status} ${auth.error}: ${auth.description}${smoke}`);
      req.resume();
      sendJson(res, auth.status, { error: auth.error, error_description: auth.description }, {
        "www-authenticate": challenge(options.auth, auth.error, auth.description),
      });
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req, maxBody);
    } catch (e) {
      if (e instanceof BodyTooLargeError) {
        jsonRpcError(res, 413, -32600, "request body too large");
      } else {
        jsonRpcError(res, 400, -32700, "parse error");
      }
      return;
    }

    const config = options.config();
    const map = config.clientTools;
    const grants = auth.clientId && map && Object.hasOwn(map, auth.clientId) ? map[auth.clientId] : [];
    const permitted = new Set(["ping", ...grants]);
    for (const message of Array.isArray(body) ? body : [body]) {
      if (message?.method === "tools/call" && typeof message.params?.name === "string" &&
          !permitted.has(message.params.name)) {
        log(`tool call denied client=${client}`);
      }
    }
    const tools = config.tools.filter((tool) => permitted.has(tool.name));
    const instructions = tools.length === config.tools.length ? config.instructions : undefined;
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      const server = buildMcpServer({ ...config, instructions, tools }, options.now, options.backend);
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      log(`error handling request: ${e}`);
      if (!res.headersSent) {
        jsonRpcError(res, 500, -32603, "internal error");
      }
    }
  });
}
