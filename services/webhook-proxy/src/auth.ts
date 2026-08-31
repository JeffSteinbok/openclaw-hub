/**
 * auth.ts — Auth validation for each route type.
 */

import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { RouteAuth } from "./config.js";
import { log } from "./config.js";

export interface AuthResult {
  ok: boolean;
  reason?: string;
}

/**
 * Read the full raw body from an IncomingMessage.
 * Returns a Buffer so HMAC can operate on raw bytes.
 */
export async function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Validate the inbound request against the route's auth config.
 */
export function validateAuth(
  auth: RouteAuth,
  headers: Record<string, string | string[] | undefined>,
  body: Buffer,
): AuthResult {
  switch (auth.type) {
    case "none":
      return { ok: true };

    case "bearer": {
      const secret = process.env[auth.secret_env];
      if (!secret) {
        log(`WARN: bearer auth env var ${auth.secret_env} not set`);
        return { ok: false, reason: "server misconfiguration" };
      }
      const authHeader = headers["authorization"];
      const token = Array.isArray(authHeader) ? authHeader[0] : authHeader;
      if (!token || !token.startsWith("Bearer ")) {
        return { ok: false, reason: "missing or malformed Authorization header" };
      }
      const incoming = token.slice("Bearer ".length);
      // Timing-safe compare
      if (incoming.length !== secret.length) {
        return { ok: false, reason: "bearer token mismatch" };
      }
      try {
        const match = crypto.timingSafeEqual(
          Buffer.from(incoming),
          Buffer.from(secret),
        );
        return match ? { ok: true } : { ok: false, reason: "bearer token mismatch" };
      } catch {
        return { ok: false, reason: "bearer token mismatch" };
      }
    }

    case "hmac-sha256": {
      const secret = process.env[auth.secret_env];
      if (!secret) {
        log(`WARN: hmac-sha256 auth env var ${auth.secret_env} not set`);
        return { ok: false, reason: "server misconfiguration" };
      }
      const headerName = auth.header.toLowerCase();
      const sigHeader = headers[headerName];
      const sig = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
      if (!sig) {
        return { ok: false, reason: `missing ${auth.header} header` };
      }
      const expected =
        "sha256=" +
        crypto.createHmac("sha256", secret).update(body).digest("hex");
      try {
        if (sig.length !== expected.length) {
          return { ok: false, reason: "hmac signature mismatch" };
        }
        const match = crypto.timingSafeEqual(
          Buffer.from(sig),
          Buffer.from(expected),
        );
        return match ? { ok: true } : { ok: false, reason: "hmac signature mismatch" };
      } catch {
        return { ok: false, reason: "hmac signature mismatch" };
      }
    }

    default:
      return { ok: false, reason: "unknown auth type" };
  }
}
