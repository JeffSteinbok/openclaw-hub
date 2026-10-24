import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { AuthFailureLimiter } from "../src/limiter.js";
import { createProxyServer } from "../src/server.js";

const GH_SECRET = "gh-test-secret";
const HASS_TOKEN = "hass-test-token";

const config: Config = {
  openclaw_url: "http://127.0.0.1:1",
  openclaw_bearer_env: "UNUSED",
  max_body_bytes: 1024,
  routes: [
    {
      path: "/github-issues",
      auth: { type: "hmac-sha256", header: "X-Hub-Signature-256", secret_env: "TEST_GH_SECRET" },
      filter: {
        type: "github-issues",
        allowedSenders: ["JeffSteinbok"],
        actionableLabels: ["ilc:approved"],
      },
      forward_path: "/hooks/github-issues",
    },
    {
      path: "/hass",
      auth: { type: "bearer", secret_env: "TEST_HASS_TOKEN" },
      forward_path: "/hooks/hass",
    },
  ],
};

interface Forwarded {
  path: string;
  bearer: string;
  body: string;
}

let server: http.Server;
let base: string;
let forwarded: Forwarded[];
let now: number;

beforeEach(async () => {
  process.env.TEST_GH_SECRET = GH_SECRET;
  process.env.TEST_HASS_TOKEN = HASS_TOKEN;
  forwarded = [];
  now = 0;
  server = createProxyServer(config, {
    bearer: "real-hooks-token",
    limiter: new AuthFailureLimiter({ maxFailures: 3, windowMs: 60_000, lockoutMs: 300_000 }, () => now),
    forward: async (_url, bearer, path, _method, _headers, body) => {
      forwarded.push({ path, bearer, body: body.toString() });
      return { status: 200, body: '{"ok":true}' };
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function sign(body: string, secret = GH_SECRET): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function github(payload: unknown, event = "issues", signature?: string) {
  const body = JSON.stringify(payload);
  return fetch(`${base}/github-issues`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-hub-signature-256": signature ?? sign(body),
    },
    body,
  });
}

const actionable = {
  action: "labeled",
  sender: { login: "JeffSteinbok" },
  label: { name: "ilc:approved" },
  issue: { number: 1 },
};

describe("routing", () => {
  it("routes by exact path and never falls back to the first route", async () => {
    const root = await fetch(`${base}/`, { method: "POST", body: "{}" });
    expect(root.status).toBe(404);
    const unknown = await fetch(`${base}/nope`, { method: "POST", body: "{}" });
    expect(unknown.status).toBe(404);
  });

  it("sends each path to its own route and credentials", async () => {
    const res = await fetch(`${base}/hass`, {
      method: "POST",
      headers: { authorization: `Bearer ${HASS_TOKEN}` },
      body: '{"event":"x"}',
    });
    expect(res.status).toBe(200);
    expect(forwarded).toEqual([{ path: "/hooks/hass", bearer: "real-hooks-token", body: '{"event":"x"}' }]);
  });

  it("ignores the query string when matching", async () => {
    const res = await fetch(`${base}/hass?x=1`, {
      method: "POST",
      headers: { authorization: `Bearer ${HASS_TOKEN}` },
      body: "{}",
    });
    expect(res.status).toBe(200);
  });

  it("does not accept one route's credentials on another route", async () => {
    const res = await fetch(`${base}/hass`, {
      method: "POST",
      headers: { authorization: `Bearer ${GH_SECRET}` },
      body: "{}",
    });
    expect(res.status).toBe(401);
    expect(forwarded).toHaveLength(0);
  });
});

describe("request limits", () => {
  it("rejects non-POST methods", async () => {
    const res = await fetch(`${base}/hass`, { method: "GET" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("rejects bodies over max_body_bytes", async () => {
    const res = await fetch(`${base}/hass`, {
      method: "POST",
      headers: { authorization: `Bearer ${HASS_TOKEN}` },
      body: "x".repeat(2048),
    }).catch(() => null);
    // Either a 413 or a reset connection is acceptable; it must never forward.
    if (res) expect(res.status).toBe(413);
    expect(forwarded).toHaveLength(0);
  });
});

describe("auth failure lockout", () => {
  const bad = () =>
    fetch(`${base}/hass`, { method: "POST", headers: { authorization: "Bearer wrong" }, body: "{}" });
  const good = () =>
    fetch(`${base}/hass`, { method: "POST", headers: { authorization: `Bearer ${HASS_TOKEN}` }, body: "{}" });

  it("locks a client out after repeated failures, even with valid credentials", async () => {
    for (let i = 0; i < 3; i++) expect((await bad()).status).toBe(401);
    const locked = await good();
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(forwarded).toHaveLength(0);
  });

  it("unlocks after the lockout period", async () => {
    for (let i = 0; i < 3; i++) await bad();
    now += 300_001;
    expect((await good()).status).toBe(200);
  });

  it("keys Funnel clients by X-Forwarded-For", async () => {
    const from = (ip: string, token: string) =>
      fetch(`${base}/hass`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "x-forwarded-for": ip },
        body: "{}",
      });
    for (let i = 0; i < 3; i++) await from("203.0.113.9", "wrong");
    expect((await from("203.0.113.9", HASS_TOKEN)).status).toBe(429);
    expect((await from("198.51.100.7", HASS_TOKEN)).status).toBe(200);
  });
});

describe("github-issues filter", () => {
  it("forwards actionable labeled events from allowed senders", async () => {
    const res = await github(actionable);
    expect(res.status).toBe(200);
    expect(forwarded.map((f) => f.path)).toEqual(["/hooks/github-issues"]);
  });

  it("rejects bad signatures before filtering", async () => {
    const res = await github(actionable, "issues", sign("{}", "other-secret"));
    expect(res.status).toBe(401);
    expect(forwarded).toHaveLength(0);
  });

  it.each([
    ["disallowed sender", { ...actionable, sender: { login: "someone-else" } }, "issues"],
    ["missing sender", { ...actionable, sender: undefined }, "issues"],
    ["non-labeled action", { ...actionable, action: "opened" }, "issues"],
    ["non-actionable label", { ...actionable, label: { name: "enhancement" } }, "issues"],
    ["unhandled event", actionable, "pull_request"],
    ["ping", { zen: "hi", sender: { login: "JeffSteinbok" } }, "ping"],
  ])("drops %s with 204", async (_name, payload, event) => {
    const res = await github(payload, event);
    expect(res.status).toBe(204);
    expect(forwarded).toHaveLength(0);
  });
});
