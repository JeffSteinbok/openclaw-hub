/**
 * proxy.ts — Forward validated requests to OpenClaw with bearer auth.
 */

import http from "node:http";
import https from "node:https";
import type { IncomingMessage, IncomingHttpHeaders } from "node:http";
import { log } from "./config.js";

export interface ForwardResult {
  status: number;
  body: string;
}

/**
 * Forward a validated webhook request to OpenClaw.
 * Strips the original Authorization header and injects the OpenClaw bearer token.
 * All other headers (including X-GitHub-Event, X-Hub-Signature-256, etc.) are passed through.
 */
export async function forwardToOpenclaw(
  openaclawUrl: string,
  bearerToken: string,
  path: string,
  method: string,
  originalHeaders: IncomingHttpHeaders,
  body: Buffer,
): Promise<ForwardResult> {
  const url = new URL(path, openaclawUrl);
  const isHttps = url.protocol === "https:";
  const transport = isHttps ? https : http;

  const headers: Record<string, string> = {
    "content-type": originalHeaders["content-type"] ?? "application/json",
    "content-length": String(body.length),
    "authorization": `Bearer ${bearerToken}`,
  };

  // Pass through relevant GitHub/webhook headers (skip hop-by-hop and auth)
  const passthrough = [
    "x-github-event",
    "x-github-delivery",
    "x-hub-signature-256",
    "x-hub-signature",
    "user-agent",
  ];
  for (const h of passthrough) {
    const val = originalHeaders[h];
    if (val) headers[h] = Array.isArray(val) ? val[0] : val;
  }

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: method || "POST",
        headers,
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString("utf-8");
          log(`forwarded → ${res.statusCode} (${path})`);
          resolve({ status: res.statusCode ?? 0, body: responseBody });
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
