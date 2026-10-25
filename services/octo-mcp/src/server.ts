/**
 * server.ts — HTTP server for the octo MCP endpoint.
 *
 * Streamable HTTP in stateless mode: every POST /mcp gets a fresh McpServer
 * and transport, so no session state lives in the process. ChatGPT reaches
 * it through Tailscale Funnel (https://<funnel-host>/mcp →
 * 127.0.0.1:18793).
 *
 * Every /mcp request needs a WorkOS AuthKit access token (see auth.ts). The
 * server publishes its protected resource metadata so ChatGPT can find
 * AuthKit; tokens are checked before the request body is read.
 *
 * Tools: `ping`, and `ask_octo` when the service is paired with the Gateway
 * (questions go to the dedicated `external` agent; see octo-gateway.ts).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { authenticate, challenge, protectedResourceMetadata, type AuthConfig } from "./auth.js";

export const MCP_PATH = "/mcp";
const PRM_PATHS = new Set(["/.well-known/oauth-protected-resource", `/.well-known/oauth-protected-resource${MCP_PATH}`]);
const AS_METADATA_PATH = "/.well-known/oauth-authorization-server";
const AS_METADATA_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export interface ServerOptions {
  /** Host header values accepted (DNS rebinding guard). Empty = accept any. */
  allowedHosts: string[];
  auth: AuthConfig;
  maxBodyBytes?: number;
  /** Fetch for the authorization-server metadata fallback (tests stub it). */
  fetch?: typeof fetch;
  log?: (message: string) => void;
  now?: () => Date;
  /** Sends a question to Octo and returns the reply; omitted when not paired. */
  ask?: AskOcto;
}

export type AskOcto = (question: string) => Promise<{ ok: boolean; text: string }>;

export function buildMcpServer(now: () => Date = () => new Date(), ask?: AskOcto): McpServer {
  const server = new McpServer({ name: "octo", version: "0.1.0" });
  server.registerTool(
    "ping",
    {
      title: "Ping Octo",
      description: "Check that the Octo MCP server is reachable. Returns pong and the server time.",
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    },
    async () => ({
      content: [{ type: "text", text: `pong ${now().toISOString()}` }],
    }),
  );
  if (ask) {
    server.registerTool(
      "ask_octo",
      {
        title: "Ask Octo",
        description:
          "Ask Octo, Jeff's home assistant, about the house or Jeff's calendar, or ask it to change something in the " +
          "house (lights, TV, fans, thermostat). Examples: 'which lights are on?', 'turn off the office light', " +
          "'what's on my calendar tomorrow?'. Returns Octo's answer as text.",
        inputSchema: { question: z.string().min(1).max(2000).describe("The question or request, in plain English") },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async ({ question }) => {
        try {
          const reply = await ask(question);
          return { content: [{ type: "text", text: reply.text }], isError: !reply.ok };
        } catch (e) {
          return { content: [{ type: "text", text: `Couldn't reach Octo: ${e instanceof Error ? e.message : e}` }], isError: true };
        }
      },
    );
  }
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
    const path = new URL(req.url ?? "/", "http://localhost").pathname.replace(/(.)\/+$/, "$1");
    const host = (req.headers.host ?? "").toLowerCase();
    log(`→ ${req.method} ${path} host=${host} ua=${req.headers["user-agent"] ?? "-"}`);

    if (allowed.size > 0 && !allowed.has(host)) {
      log(`421 host not allowed: ${host}`);
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
    if (req.method !== "POST") {
      // Stateless mode has no standalone SSE stream or session to delete.
      res.writeHead(405, { allow: "POST" }).end();
      return;
    }

    const auth = await authenticate(req.headers.authorization, options.auth);
    if (!auth.ok) {
      log(`${auth.status} ${auth.error}: ${auth.description}${auth.sub ? ` (sub=${auth.sub})` : ""}`);
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

    const server = buildMcpServer(options.now, options.ask);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
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
