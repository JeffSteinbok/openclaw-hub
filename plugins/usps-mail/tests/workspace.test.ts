import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

vi.mock("@openclaw/mail-action-usps", () => import("../../../libs/ts/mail_action_usps/src/index.js"));
vi.mock("@openclaw/mail-action-usps/rules", () => import("../../../libs/ts/mail_action_usps/src/rules.js"));
vi.mock("@openclaw/mail-action-usps/memory", () => import("../../../libs/ts/mail_action_usps/src/memory.js"));

import { createEntry } from "../src/index.js";

it("the registered tool uses api.config and returns both memory path forms", async () => {
  const folder = mkdtempSync(join(tmpdir(), "usps-workspace-tool-"));
  const workspace = join(folder, "configured-workspace");
  let digest: ((id: string, params: Record<string, unknown>) => Promise<unknown>) | undefined;
  const config = { agents: { entries: { mail: { workspace } } } };
  const resolveWorkspace = vi.fn(() => workspace);
  try {
    writeFileSync(join(folder, "body.html"), "<p>You have 0 mailpieces arriving today.</p>");
    createEntry().register({
      config,
      runtime: { agent: { resolveAgentWorkspaceDir: resolveWorkspace } },
      registerTool(tool) {
        const t = tool as { name: string; execute: typeof digest };
        if (t.name === "usps_process_digest") digest = t.execute;
      },
    });
    expect(digest).toBeDefined();
    const result = await digest!("test", {
      folder,
      date: "2026-11-25",
      analysis: [],
      vision_backend: "provided",
      workspace_agent: "MAIL",
      memory_agent: "MAIL",
      persist_analysis: false,
      write_memory: true,
      send_notifications: false,
      update_workflow_state: false,
    }) as { content: [{ text: string }] };
    const output = JSON.parse(result.content[0].text);
    const relative = "memory/mail/mail_memory_2026-11.md";
    expect(output.memory_file).toBe(join(workspace, relative));
    expect(output.memory_file_relative).toBe(relative);
    expect(existsSync(output.memory_file)).toBe(true);
    expect(resolveWorkspace).toHaveBeenCalledWith(config, "mail");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
