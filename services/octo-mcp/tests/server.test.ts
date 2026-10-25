import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createMcpHttpServer } from "../src/server.js";

let server: Server;
let base: string;
let host: string;

const ACCEPT = "application/json, text/event-stream";

async function rpc(method: string, params: unknown = {}, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: ACCEPT, ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return { status: res.status, body: res.status === 200 ? await res.json() : await res.text() };
}

beforeAll(async () => {
  server = createMcpHttpServer({
    allowedHosts: [],
    now: () => new Date("2026-10-25T00:00:00Z"),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  host = `127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

describe("octo-mcp", () => {
  it("initializes", async () => {
    const { status, body } = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(status).toBe(200);
    expect(body.result.serverInfo.name).toBe("octo");
  });

  it("lists only the read-only ping tool", async () => {
    const { body } = await rpc("tools/list");
    expect(body.result.tools.map((t: { name: string }) => t.name)).toEqual(["ping"]);
    expect(body.result.tools[0].annotations.readOnlyHint).toBe(true);
  });

  it("answers ping", async () => {
    const { body } = await rpc("tools/call", { name: "ping", arguments: {} });
    expect(body.result.content[0].text).toBe("pong 2026-10-25T00:00:00.000Z");
  });

  it("404s other paths and 405s other methods", async () => {
    expect((await fetch(`${base}/`, { method: "POST" })).status).toBe(404);
    expect((await fetch(`${base}/mcp`)).status).toBe(405);
  });

  it("rejects bad JSON and oversized bodies", async () => {
    const bad = await fetch(`${base}/mcp`, { method: "POST", headers: { accept: ACCEPT }, body: "{" });
    expect(bad.status).toBe(400);
    const big = await fetch(`${base}/mcp`, { method: "POST", headers: { accept: ACCEPT }, body: "x".repeat(2 * 1024 * 1024) });
    expect(big.status).toBe(413);
  });

  it("enforces the Host allowlist when configured", async () => {
    const guarded = createMcpHttpServer({ allowedHosts: ["octo.example:8443"] });
    await new Promise<void>((resolve) => guarded.listen(0, "127.0.0.1", resolve));
    const { port } = guarded.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", body: "{}" });
    expect(res.status).toBe(421);
    guarded.close();
    expect(host).toContain("127.0.0.1");
  });
});
