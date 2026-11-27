import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, lstat, mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listenMcpBridge, removeStaleSocket } from "../src/proxy-listeners.js";
import type { ServerOptions } from "../src/server.js";

const options: ServerOptions = {
  config: () => ({ name: "test", tools: [] }),
  allowedHosts: [],
  auth: {
    issuer: "https://issuer.example.test",
    resource: "https://mcp.example.test/mcp",
    allowedSubjects: [],
    keys: async () => { throw new Error("verification is unavailable in this test"); },
  },
};

async function withDirectory(run: (directory: string) => Promise<void>) {
  // Keep below macOS's sockaddr_un path limit even when TMPDIR is long.
  const directory = await mkdtemp(join("/tmp", "mcp-listeners-"));
  try {
    await chmod(directory, 0o700);
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("private proxy listener startup", () => {
  it("rejects overlapping starts and leaves the active sockets intact", async () => {
    await withDirectory(async (directory) => {
      const servers = await listenMcpBridge(options, 0, directory);
      try {
        const socket = join(directory, "mcp.sock");
        const original = await lstat(socket);
        const port = (servers[0].address() as AddressInfo).port;
        await expect(listenMcpBridge(options, port, directory)).rejects.toMatchObject({ code: "EADDRINUSE" });
        await expect(listenMcpBridge(options, 0, directory)).rejects.toThrow("already has a listener");
        expect((await lstat(socket)).ino).toBe(original.ino);
        expect((await lstat(socket)).mode & 0o777).toBe(0o600);
      } finally {
        await Promise.all(servers.map(close));
      }
    });
  });

  it("removes a socket left behind by a killed listener", async () => {
    await withDirectory(async (directory) => {
      const socket = join(directory, "mcp.sock");
      const child = spawn(process.execPath, ["-e", `
        require("node:net").createServer().listen(process.argv[1], () => console.log("ready"));
      `, socket]);
      const exited = once(child, "exit");
      try {
        await Promise.race([
          once(child.stdout, "data"),
          exited.then(() => { throw new Error("socket fixture exited before binding"); }),
        ]);
      } finally {
        child.kill("SIGKILL");
        await exited;
      }
      expect((await lstat(socket)).isSocket()).toBe(true);
      await removeStaleSocket(socket, process.getuid!());
      await expect(lstat(socket)).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it.skipIf(process.platform !== "darwin")("rejects ACLs on the socket directory", async () => {
    await withDirectory(async (directory) => {
      execFileSync("/bin/chmod", ["+a", "everyone allow search", directory]);
      try {
        await expect(listenMcpBridge(options, 0, directory)).rejects.toThrow("must not have a macOS ACL");
      } finally {
        execFileSync("/bin/chmod", ["-N", directory]);
      }
    });
  });
});
