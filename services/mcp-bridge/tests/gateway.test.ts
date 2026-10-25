import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DeviceStore, asPlainText, deviceIdFor, publicKeyRawBase64Url, signPayload } from "../src/octo-gateway.js";

describe("device identity", () => {
  it("derives the device id as sha256 of the raw Ed25519 public key (OpenClaw's scheme)", () => {
    const { publicKey } = crypto.generateKeyPairSync("ed25519");
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const raw = (publicKey.export({ format: "jwk" }) as { x: string }).x; // JWK x = raw key, base64url
    expect(publicKeyRawBase64Url(pem)).toBe(raw);
    expect(deviceIdFor(pem)).toBe(crypto.createHash("sha256").update(Buffer.from(raw, "base64url")).digest("hex"));
  });

  it("signs payloads the Gateway can verify", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const sig = signPayload(privateKey.export({ type: "pkcs8", format: "pem" }).toString(), "v3|payload");
    expect(crypto.verify(null, Buffer.from("v3|payload"), publicKey, Buffer.from(sig, "base64url"))).toBe(true);
  });

  it("rejects non-Ed25519 keys", () => {
    const { publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    expect(() => publicKeyRawBase64Url(publicKey.export({ type: "spki", format: "pem" }).toString())).toThrow();
  });
});

describe("DeviceStore", () => {
  it("creates one identity, keeps the token private, and reports pairing", () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "octo-mcp-")), "device");
    const store = new DeviceStore(dir);
    expect(store.isPaired()).toBe(false);
    const first = store.loadOrCreateIdentity();
    expect(store.loadOrCreateIdentity().deviceId).toBe(first.deviceId);
    expect(first.deviceId).toBe(deviceIdFor(first.publicKeyPem));
    expect(store.isPaired()).toBe(false);
    store.storeToken("device-token", ["operator.read", "operator.write"]);
    expect(store.isPaired()).toBe(true);
    for (const file of ["device.json", "token.json"]) {
      expect(fs.statSync(path.join(dir, file)).mode & 0o777).toBe(0o600);
    }
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    store.clearToken();
    expect(store.isPaired()).toBe(false);
    expect(store.loadDestinations()).toEqual({});
    fs.writeFileSync(
      path.join(dir, "recipients.json"),
      JSON.stringify({
        jeff: "+15555550100",
        general: { channel: "discord", to: "channel:123" },
        sms: { channel: "sms", to: "+1555" },
        "Bad Name": "x",
        empty: "",
      }),
    );
    expect(store.loadDestinations()).toEqual({
      jeff: { channel: "imessage", to: "+15555550100" },
      general: { channel: "discord", to: "channel:123" },
    });
  });
});

describe("asPlainText", () => {
  it("defuses text that would be read as an OpenClaw command", () => {
    expect(asPlainText("/reset")).toBe("Question: /reset");
    expect(asPlainText("  !exec ls")).toBe("Question: !exec ls");
    expect(asPlainText("which lights are on?")).toBe("which lights are on?");
  });
});
