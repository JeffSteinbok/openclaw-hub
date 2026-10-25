/**
 * server.ts — HTTP server for the octo MCP endpoint.
 *
 * Streamable HTTP in stateless mode: every POST /mcp gets a fresh McpServer
 * and transport, so no session state lives in the process. ChatGPT reaches
 * it through Tailscale Funnel (https://octo.tail498490.ts.net:8443/mcp →
 * 127.0.0.1:18793).
 *
 * Spike (octo#441): one read-only `ping` tool and no auth. OAuth and the
 * ask_octo tool come in octo#442.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export const MCP_PATH = "/mcp";
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export interface ServerOptions {
  /** Host header values accepted (DNS rebinding guard). Empty = accept any. */
  allowedHosts: string[];
  maxBodyBytes?: number;
  log?: (message: string) => void;
  now?: () => Date;
}

export function buildMcpServer(now: () => Date = () => new Date()): McpServer {
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
      if (tooLarge) {
        return; // discard the rest so the 413 can still be read
      }
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) {
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

  return createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const host = (req.headers.host ?? "").toLowerCase();
    log(`→ ${req.method} ${path} host=${host} ua=${req.headers["user-agent"] ?? "-"}`);

    if (allowed.size > 0 && !allowed.has(host)) {
      log(`421 host not allowed: ${host}`);
      sendJson(res, 421, { error: "misdirected request" });
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

    let body: unknown;
    try {
      body = await readJsonBody(req, maxBody);
    } catch (e) {
      if (e instanceof BodyTooLargeError) {
        res.setHeader("connection", "close");
        jsonRpcError(res, 413, -32600, "request body too large");
      } else {
        jsonRpcError(res, 400, -32700, "parse error");
      }
      return;
    }

    const server = buildMcpServer(options.now);
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
