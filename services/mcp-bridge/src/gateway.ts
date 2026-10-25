/**
 * gateway.ts — the bridge's connection to the OpenClaw Gateway.
 *
 * The bridge is its own paired operator device with operator.read and
 * operator.write. That can't change config, pair devices, or use owner-only
 * tools; it does allow chat.send to any agent, tools.invoke, and send. The
 * bridge's code is what keeps it to the configured tools. It never holds the
 * shared Gateway token; that is used once, by `pair`, to request pairing.
 *
 * Private files in MCP_BRIDGE_DEVICE_DIR (mode 700/600):
 *   device.json        Ed25519 key pair and the device id derived from it
 *   token.json         the device token the Gateway issued, with its scopes
 *   destinations.json  {"name": {"channel": "imessage"|"discord", "to": "<target>"}}
 *                      (recipients.json is read if destinations.json is missing)
 *
 * operator.write is the narrowest scope that works for a device: the
 * session-only scopes need a verified user profile.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { GatewayClient, recoverTerminalReply, type DeviceIdentity } from "@openclaw/gateway-client";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";

export const ROLE = "operator";
export const SCOPES = ["operator.read", "operator.write"];
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

// ── device identity ────────────────────────────────────────────────────────

/** Raw 32-byte Ed25519 public key, base64url (what the Gateway expects). */
export function publicKeyRawBase64Url(publicKeyPem: string): string {
  const der = crypto.createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  if (der.length !== ED25519_SPKI_PREFIX.length + 32 || !der.subarray(0, 12).equals(ED25519_SPKI_PREFIX)) {
    throw new Error("not an Ed25519 public key");
  }
  return der.subarray(ED25519_SPKI_PREFIX.length).toString("base64url");
}

/** Device id = sha256 of the raw public key, hex (matches OpenClaw's own clients). */
export function deviceIdFor(publicKeyPem: string): string {
  return crypto.createHash("sha256").update(Buffer.from(publicKeyRawBase64Url(publicKeyPem), "base64url")).digest("hex");
}

export function signPayload(privateKeyPem: string, payload: string): string {
  return crypto.sign(null, Buffer.from(payload, "utf8"), crypto.createPrivateKey(privateKeyPem)).toString("base64url");
}

function writePrivate(file: string, data: unknown): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export class DeviceStore {
  constructor(readonly dir: string) {}

  private get identityFile() {
    return path.join(this.dir, "device.json");
  }
  private get tokenFile() {
    return path.join(this.dir, "token.json");
  }

  loadIdentity(): DeviceIdentity | null {
    try {
      return JSON.parse(fs.readFileSync(this.identityFile, "utf8")) as DeviceIdentity;
    } catch {
      return null;
    }
  }

  loadOrCreateIdentity(): DeviceIdentity {
    const existing = this.loadIdentity();
    if (existing) return existing;
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const identity: DeviceIdentity = {
      deviceId: deviceIdFor(publicKeyPem),
      publicKeyPem,
      privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    };
    writePrivate(this.identityFile, identity);
    return identity;
  }

  loadToken(): { token?: string; scopes?: string[] } | null {
    try {
      return JSON.parse(fs.readFileSync(this.tokenFile, "utf8"));
    } catch {
      return null;
    }
  }

  storeToken(token: string, scopes: string[]): void {
    writePrivate(this.tokenFile, { token, scopes });
  }

  clearToken(): void {
    fs.rmSync(this.tokenFile, { force: true });
  }

  /** Allowlisted message destinations, by name. Missing file = nobody. */
  loadDestinations(): Record<string, Destination> {
    let data: Record<string, unknown>;
    const file = ["destinations.json", "recipients.json"].map((f) => path.join(this.dir, f)).find((f) => fs.existsSync(f));
    try {
      data = file ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    } catch {
      return {};
    }
    const out: Record<string, Destination> = {};
    for (const [name, value] of Object.entries(data)) {
      if (!/^[a-z][a-z0-9_-]*$/.test(name)) continue;
      // A bare string is an iMessage handle (the original format).
      const dest = typeof value === "string" ? { channel: "imessage", to: value } : (value as Partial<Destination>);
      if ((dest.channel === "imessage" || dest.channel === "discord") && typeof dest.to === "string" && dest.to) {
        out[name] = { channel: dest.channel, to: dest.to };
      }
    }
    return out;
  }

  /** Paired = identity on disk and a device token the Gateway issued. */
  isPaired(): boolean {
    return Boolean(this.loadIdentity() && this.loadToken()?.token);
  }
}

// ── client ─────────────────────────────────────────────────────────────────

export interface GatewayOptions {
  url: string;
  store: DeviceStore;
  /** Shared Gateway token, only for the first (pairing) connection. */
  bootstrapToken?: string;
  /** Shown in `openclaw devices list` when pairing. */
  displayName?: string;
  log?: (message: string) => void;
  onConnectError?: (err: Error) => void;
}

export function createGatewayClient(opts: GatewayOptions, onReady: () => void, onClose: () => void): GatewayClient {
  const identity = opts.store.loadOrCreateIdentity();
  const log = opts.log ?? (() => {});
  return new GatewayClient({
    url: opts.url,
    ...(opts.bootstrapToken ? { token: opts.bootstrapToken } : {}),
    minProtocol: PROTOCOL_VERSION,
    maxProtocol: PROTOCOL_VERSION,
    // Not "gateway-client": with mode "backend" on loopback plus the shared token,
    // the Gateway treats that as its own internal helper and skips device pairing
    // (shouldSkipLocalBackendSelfPairing). "cli" + "backend" gets ordinary
    // pairing, so the bridge ends up with its own scoped device token.
    clientName: "cli",
    clientDisplayName: opts.displayName ?? "mcp-bridge",
    clientVersion: "0.3.0",
    mode: "backend",
    platform: "macos",
    role: ROLE,
    scopes: SCOPES,
    deviceIdentity: identity,
    hostDeps: {
      signDevicePayload: signPayload,
      publicKeyRawBase64UrlFromPem: publicKeyRawBase64Url,
      loadDeviceAuthToken: () => opts.store.loadToken(),
      storeDeviceAuthToken: ({ token, scopes }) => opts.store.storeToken(token, scopes),
      clearDeviceAuthToken: () => opts.store.clearToken(),
      logDebug: () => {},
      logError: (m) => log(`gateway client: ${m}`),
    },
    onHelloOk: () => onReady(),
    onClose: () => onClose(),
    onConnectError: (err) => {
      log(`gateway connect error: ${err.message}`);
      opts.onConnectError?.(err);
    },
  });
}

export interface Destination {
  channel: "imessage" | "discord";
  /** Channel target: an iMessage handle, or a Discord "user:<id>" / "channel:<id>". */
  to: string;
}

export interface AskResult {
  ok: boolean;
  text: string;
}

/** One long-lived Gateway connection for ask(), invoke() and send(). */
export class OpenClawGateway {
  private client: GatewayClient | null = null;
  private ready: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;

  constructor(private readonly opts: GatewayOptions) {}

  private connect(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });
    this.client = createGatewayClient(
      this.opts,
      () => this.resolveReady?.(),
      () => {
        // The client reconnects on its own; later requests wait for the next hello.
        this.ready = null;
      },
    );
    this.client.start();
    return this.ready;
  }

  private async connected(): Promise<GatewayClient> {
    await withTimeout(this.connect(), 15_000, "the OpenClaw Gateway didn't accept the connection");
    return this.client!;
  }

  /** Send a prompt to `agent` (session agent:<agent>:mcp) and return its reply. */
  async ask(agent: string, question: string, timeoutMs = 90_000): Promise<AskResult> {
    const deadline = AbortSignal.timeout(timeoutMs + 15_000);
    const client = await this.connected();
    const scope = { sessionKey: `agent:${agent}:mcp`, agentId: agent };
    const sent = (await client.request("chat.send", {
      ...scope,
      message: asPlainText(question),
      deliver: false,
      timeoutMs,
      idempotencyKey: crypto.randomUUID(),
    })) as { runId?: string };
    if (!sent?.runId) {
      return { ok: false, text: "OpenClaw didn't accept the question." };
    }
    const result = (await client.request(
      "agent.wait",
      { runId: sent.runId, timeoutMs },
      { timeoutMs: timeoutMs + 10_000 },
    )) as { status?: string; error?: string };
    if (result?.status && result.status !== "ok") {
      return { ok: false, text: `The agent's run ended with status ${result.status}${result.error ? `: ${result.error}` : ""}.` };
    }
    const reply = await recoverTerminalReply({
      runId: sent.runId,
      scope,
      result,
      request: (method, params) => client.request(method, params),
      signal: deadline,
    });
    if (reply.outputText === undefined) {
      return { ok: false, text: `The agent finished but its reply couldn't be read (${reply.unavailable ?? "unknown"}).` };
    }
    return { ok: true, text: reply.outputText || "(No reply.)" };
  }

  /**
   * Call one OpenClaw tool directly (tools.invoke) under `agent`'s tool policy.
   * Returns the tool's structured result (`details`), falling back to its text.
   */
  async invoke(agent: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
    const client = await this.connected();
    const r = (await client.request("tools.invoke", {
      name: tool,
      agentId: agent,
      args,
      idempotencyKey: crypto.randomUUID(),
    })) as { ok?: boolean; output?: { details?: unknown; content?: { text?: string }[] }; error?: { message?: string } };
    if (!r?.ok) throw new Error(`${tool}: ${r?.error?.message ?? "failed"}`);
    const details = r.output?.details;
    if (details !== undefined && details !== null && !(typeof details === "object" && Object.keys(details).length === 0)) {
      return details;
    }
    const text = r.output?.content?.[0]?.text ?? "";
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /** Send a message directly through the Gateway (no agent involved). */
  async send(dest: Destination, message: string): Promise<AskResult> {
    const client = await this.connected();
    await client.request("send", {
      channel: dest.channel,
      to: dest.to,
      message,
      idempotencyKey: crypto.randomUUID(),
    });
    return { ok: true, text: "Sent." };
  }

  stop(): void {
    this.client?.stop();
  }
}

/**
 * Keep an outside assistant's text from being read as an OpenClaw command
 * ("/reset", "!…"). suppressCommandInterpretation would do this, but it's a
 * system-provenance field that needs operator.admin, which the bridge
 * deliberately doesn't have.
 */
export function asPlainText(question: string): string {
  const trimmed = question.trimStart();
  return /^[/!]/.test(trimmed) ? `Question: ${trimmed}` : question;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
