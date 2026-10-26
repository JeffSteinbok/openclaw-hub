import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createEntry } from "./index.js";

/**
 * Collects the tools register() emits, instantiated with the given OpenClaw
 * tool context. Each tool exposes OpenClaw's `execute(toolCallId, params)`.
 */
function collectTools(ctx?: unknown) {
  const tools: any[] = [];
  createEntry().register({
    pluginConfig: {},
    registerTool: (factory: any) => tools.push(ctx === undefined ? factory : factory(ctx)),
  } as any);
  return tools.map((t) => ({ ...t, execute: (params: unknown) => t.execute("call-1", params) }));
}

async function tmpWorkspace(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "fs-utils-test-"));
}

describe("fs-utils", () => {
  it("declares the workspace file tools", () => {
    const names = collectTools({ workspaceDir: "/tmp" }).map((t) => t.name);
    expect(names).toEqual(["fs_list", "fs_copy", "fs_move"]);
  });

  it("fails clearly when workspaceDir is missing", async () => {
    const [list] = collectTools({ agentId: "main" });
    await expect(list.execute({ path: "." })).rejects.toThrow(/workspaceDir not available/);
  });

  it("fails clearly with no tool context (standalone CLI)", async () => {
    const [list] = collectTools();
    await expect(list.execute({ path: "." })).rejects.toThrow(/workspaceDir not available/);
  });

  it("scopes each call to the calling agent's workspace", async () => {
    const a = await tmpWorkspace();
    const b = await tmpWorkspace();
    await fs.writeFile(path.join(a, "only-a.txt"), "a");
    const [listB] = collectTools({ agentId: "b", workspaceDir: b });
    const res = (await listB.execute({ path: "." })) as { details: { entries: string[] } };
    expect(res.details.entries).toEqual([]);
    await expect(listB.execute({ path: path.relative(b, a) })).rejects.toThrow(/outside the workspace boundary/);
  });

  it("refuses paths that escape the workspace", async () => {
    const ws = await tmpWorkspace();
    const [list] = collectTools({ workspaceDir: ws });
    await expect(list.execute({ path: "../.." })).rejects.toThrow(/outside the workspace boundary/);
  });

  it("lists workspace entries, marking directories", async () => {
    const ws = await tmpWorkspace();
    await fs.writeFile(path.join(ws, "a.txt"), "a");
    await fs.mkdir(path.join(ws, "sub"));
    const [list] = collectTools({ workspaceDir: ws });
    const res = (await list.execute({ path: "." })) as { content: unknown[]; details: { entries: string[] } };
    expect(res.content).toEqual([{ type: "text", text: expect.stringContaining('"entries"') }]);
    expect(res.details.entries.sort()).toEqual(["a.txt", "sub/"]);
  });

  it("copies a file and refuses to clobber without overwrite", async () => {
    const ws = await tmpWorkspace();
    await fs.writeFile(path.join(ws, "src.txt"), "hello");
    const [, copy] = collectTools({ workspaceDir: ws });
    await copy.execute({ source: "src.txt", destination: "nested/dst.txt" });
    expect(await fs.readFile(path.join(ws, "nested/dst.txt"), "utf8")).toBe("hello");
    await expect(copy.execute({ source: "src.txt", destination: "nested/dst.txt" }))
      .rejects.toThrow(/already exists/);
  });

  it("moves a file, removing the source", async () => {
    const ws = await tmpWorkspace();
    await fs.writeFile(path.join(ws, "from.txt"), "x");
    const [, , move] = collectTools({ workspaceDir: ws });
    await move.execute({ source: "from.txt", destination: "to.txt" });
    expect(await fs.readFile(path.join(ws, "to.txt"), "utf8")).toBe("x");
    await expect(fs.access(path.join(ws, "from.txt"))).rejects.toThrow();
  });
});
