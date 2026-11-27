import { execFileSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import type { Server } from "node:http";
import { createConnection } from "node:net";
import { isAbsolute, join } from "node:path";
import { createMcpHttpServer, type ServerOptions } from "./server.js";

const mounts = {
  "mcp.sock": "/mcp",
  "resource.sock": "/.well-known/oauth-protected-resource",
  "auth.sock": "/.well-known/oauth-authorization-server",
};

function assertPrivateDirectory(directory: string): number {
  if (!isAbsolute(directory)) throw new Error("proxy socket directory must be absolute");
  mkdirSync(directory, { mode: 0o700, recursive: true });
  const metadata = lstatSync(directory);
  if (!metadata.isDirectory() || metadata.uid !== process.getuid?.() || (metadata.mode & 0o777) !== 0o700) {
    throw new Error("proxy socket directory must be owned by the bridge user with mode 0700");
  }
  if (process.platform === "darwin") {
    const mode = execFileSync("/bin/ls", ["-lde", directory], { encoding: "utf8" }).split(/\s/, 1)[0];
    if (mode.includes("+")) throw new Error("proxy socket directory must not have a macOS ACL");
  }
  return metadata.uid;
}

export async function removeStaleSocket(socket: string, uid: number): Promise<void> {
  const original = lstatSync(socket, { throwIfNoEntry: false });
  if (!original) return;
  if (!original.isSocket() || original.uid !== uid) throw new Error("unexpected file at proxy socket path");

  await new Promise<void>((resolve, reject) => {
    const peer = createConnection(socket);
    peer.once("connect", () => {
      peer.destroy();
      reject(new Error("proxy socket already has a listener"));
    });
    peer.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNREFUSED" || error.code === "ENOENT") resolve();
      else reject(error);
    });
  });
  const current = lstatSync(socket, { throwIfNoEntry: false });
  if (!current) return;
  if (current.dev !== original.dev || current.ino !== original.ino || current.ctimeMs !== original.ctimeMs) {
    throw new Error("proxy socket changed while checking its listener");
  }
  unlinkSync(socket);
}

export async function listenMcpBridge(options: ServerOptions, port: number, directory: string): Promise<Server[]> {
  const tcp = createMcpHttpServer(options);
  const started: Server[] = [];
  let startupLock: string | undefined;
  try {
    // Claim the service port before inspecting or changing any socket path.
    await new Promise<void>((resolve, reject) => tcp.once("error", reject).listen(port, "127.0.0.1", resolve));
    started.push(tcp);
    if (!directory) return started;
    const uid = assertPrivateDirectory(directory);
    if (process.platform === "darwin") {
      // Also serialize macOS launches that use a different TCP port but point
      // at the same directory. shlock can recover the lock after a crash.
      const lock = join(directory, ".startup.lock");
      execFileSync("/usr/bin/shlock", ["-f", lock, "-p", String(process.pid)]);
      startupLock = lock;
    }
    for (const [name, proxyMount] of Object.entries(mounts)) {
      const socket = join(directory, name);
      await removeStaleSocket(socket, uid);
      const server = createMcpHttpServer({ ...options, proxyMount });
      await new Promise<void>((resolve, reject) => server.once("error", reject).listen(socket, resolve));
      started.push(server);
      chmodSync(socket, 0o600);
    }
    return started;
  } catch (error) {
    for (const server of started) server.close();
    throw error;
  } finally {
    if (startupLock) unlinkSync(startupLock);
  }
}
