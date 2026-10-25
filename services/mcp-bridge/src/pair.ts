/**
 * pair.ts — one-time pairing of octo-mcp with the OpenClaw Gateway.
 *
 *   OPENCLAW_GATEWAY_TOKEN=… node dist/pair.js
 *
 * Creates the device identity (if needed) and connects once with the shared
 * Gateway token to request an operator pairing with only operator.read and
 * operator.write. Approve the request on the Gateway host
 * (`openclaw devices approve <requestId>`) if it isn't auto-approved, then run
 * this again. On success the Gateway's device token is stored and the shared
 * token is never used again.
 *
 * Env: OCTO_MCP_DEVICE_DIR (default ~/.openclaw/secrets/octo-mcp),
 *      OCTO_MCP_GATEWAY_URL (default ws://127.0.0.1:18789).
 */

import os from "node:os";
import path from "node:path";
import { DeviceStore, SCOPES, createGatewayClient } from "./octo-gateway.js";

const dir = process.env["OCTO_MCP_DEVICE_DIR"] ?? path.join(os.homedir(), ".openclaw/secrets/octo-mcp");
const url = process.env["OCTO_MCP_GATEWAY_URL"] ?? "ws://127.0.0.1:18789";
const bootstrapToken = process.env["OPENCLAW_GATEWAY_TOKEN"];
const store = new DeviceStore(dir);

if (store.isPaired()) {
  console.log(`Already paired as device ${store.loadIdentity()!.deviceId} (${dir}). Delete token.json to re-pair.`);
  process.exit(0);
}
if (!bootstrapToken) {
  console.error("Set OPENCLAW_GATEWAY_TOKEN for this one command (it is not stored).");
  process.exit(2);
}

const identity = store.loadOrCreateIdentity();
console.log(`Device ${identity.deviceId}, requesting operator scopes: ${SCOPES.join(", ")}`);

const client = createGatewayClient(
  {
    url,
    store,
    bootstrapToken,
    log: (m) => console.error(m),
    onConnectError: (err) => {
      const details = (err as { details?: Record<string, unknown> }).details ?? {};
      if (details["requestId"]) {
        console.log(`Pairing requested: ${details["requestId"]}. Approve it with:`);
        console.log(`  openclaw devices approve ${details["requestId"]}`);
        console.log("then run this again.");
      } else {
        console.error(`Connect failed: ${err.message}`);
      }
      client.stop();
      process.exit(details["requestId"] ? 3 : 1);
    },
  },
  () => {
    const paired = store.isPaired();
    console.log(paired ? `Paired. Device token stored in ${dir}.` : "Connected, but no device token was issued.");
    client.stop();
    process.exit(paired ? 0 : 1);
  },
  () => {},
);
client.start();
setTimeout(() => {
  console.error("Timed out waiting for the Gateway.");
  process.exit(1);
}, 30_000).unref();
