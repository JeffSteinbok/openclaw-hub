import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type CryptoKey } from "jose";
import { createMcpHttpServer } from "../src/server.js";
import type { AuthConfig } from "../src/auth.js";

const ISSUER = "https://octo-test.authkit.app";
const RESOURCE = "https://octo.example:8443/mcp";
const OWNER = "user_owner";
const ACCEPT = "application/json, text/event-stream";

let server: Server;
let base: string;
let privateKey: CryptoKey;
let otherKey: CryptoKey;
let auth: AuthConfig;

async function token(claims: Record<string, unknown> = {}, opts: { key?: CryptoKey; exp?: string } = {}) {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer((claims.iss as string) ?? ISSUER)
    .setAudience((claims.aud as string) ?? RESOURCE)
    .setSubject((claims.sub as string) ?? OWNER)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "5m")
    .sign(opts.key ?? privateKey);
}

async function rpc(method: string, bearer?: string, params: unknown = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", accept: ACCEPT };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : undefined };
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair("RS256")).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "test", alg: "RS256" };
  auth = { issuer: ISSUER, resource: RESOURCE, allowedSubjects: [OWNER], keys: createLocalJWKSet({ keys: [jwk] }) };
  server = createMcpHttpServer({
    allowedHosts: [],
    auth,
    now: () => new Date("2026-10-25T00:00:00Z"),
    fetch: (async (url: string) =>
      new Response(JSON.stringify({ issuer: ISSUER, fetched: url }), { status: 200 })) as unknown as typeof fetch,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

describe("discovery", () => {
  it("serves protected resource metadata at the root and /mcp paths", async () => {
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const res = await fetch(base + path);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        resource: RESOURCE,
        authorization_servers: [ISSUER],
        bearer_methods_supported: ["header"],
      });
    }
  });

  it("proxies AuthKit's authorization server metadata", async () => {
    const res = await fetch(`${base}/.well-known/oauth-authorization-server`);
    expect(await res.json()).toEqual({ issuer: ISSUER, fetched: `${ISSUER}/.well-known/oauth-authorization-server` });
  });
});

describe("auth", () => {
  it("rejects a request without a token with a resource_metadata challenge", async () => {
    const res = await rpc("initialize");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://octo.example:8443/.well-known/oauth-protected-resource/mcp", ' +
        'error="invalid_request", error_description="Authorization needed"',
    );
  });

  it("rejects tokens with the wrong audience, issuer, signature, or expiry", async () => {
    const bad = [
      await token({ aud: "https://octo.example:8443" }),
      await token({ iss: "https://evil.authkit.app" }),
      await token({}, { key: otherKey }),
      await token({}, { exp: "-1m" }),
      "not-a-jwt",
    ];
    for (const t of bad) {
      const res = await rpc("tools/list", t);
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
    }
  });

  it("rejects a valid token for someone not on the allowlist", async () => {
    const res = await rpc("tools/list", await token({ sub: "user_stranger" }));
    expect(res.status).toBe(403);
    expect(res.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
  });
});

describe("mcp with a valid token", () => {
  it("initializes and lists only the read-only ping tool", async () => {
    const t = await token();
    const init = await rpc("initialize", t, {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe("octo");
    const list = await rpc("tools/list", t);
    expect(list.body.result.tools.map((x: { name: string }) => x.name)).toEqual(["ping"]);
    expect(list.body.result.tools[0].annotations.readOnlyHint).toBe(true);
  });

  it("answers ping", async () => {
    const res = await rpc("tools/call", await token(), { name: "ping", arguments: {} });
    expect(res.body.result.content[0].text).toBe("pong 2026-10-25T00:00:00.000Z");
  });
});

describe("http hygiene", () => {
  it("404s other paths and 405s other methods", async () => {
    expect((await fetch(`${base}/`, { method: "POST" })).status).toBe(404);
    expect((await fetch(`${base}/mcp`)).status).toBe(405);
  });

  it("rejects bad JSON and oversized bodies from an authenticated caller", async () => {
    const headers = { accept: ACCEPT, authorization: `Bearer ${await token()}` };
    expect((await fetch(`${base}/mcp`, { method: "POST", headers, body: "{" })).status).toBe(400);
    const big = await fetch(`${base}/mcp`, { method: "POST", headers, body: "x".repeat(2 * 1024 * 1024) });
    expect(big.status).toBe(413);
  });

  it("enforces the Host allowlist before anything else", async () => {
    const guarded = createMcpHttpServer({ allowedHosts: ["octo.example:8443"], auth });
    await new Promise<void>((resolve) => guarded.listen(0, "127.0.0.1", resolve));
    const res = await fetch(`http://127.0.0.1:${(guarded.address() as AddressInfo).port}/mcp`, { method: "POST" });
    expect(res.status).toBe(421);
    guarded.close();
  });
});
