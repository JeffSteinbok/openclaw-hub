import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { register } from "./index.js";

/** Collects the tool definitions register() emits, for a given context. */
function collectTools(ctx: unknown) {
  const tools: any[] = [];
  register({ registerTool: (factory: (c: unknown) => unknown) => tools.push(factory(ctx)) });
  return tools;
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
    const res = (await list.execute({ path: "." })) as { entries: string[] };
    expect(res.entries.sort()).toEqual(["a.txt", "sub/"]);
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
