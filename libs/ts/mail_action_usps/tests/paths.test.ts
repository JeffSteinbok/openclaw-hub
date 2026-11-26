import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { homedir, tmpdir } from "node:os";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  getAnalysisFile,
  getConfigFile,
  getLongTermMemoryDir,
  getMemoryDir,
  getRulesFile,
  getStateFile,
  getUspsDir,
  getWorkspaceAgent,
  getWorkspaceRoot,
  withWorkspaceConfig,
} from "../src/paths.js";

let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "usps-paths-"));
  vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
  vi.stubEnv("OPENCLAW_CONFIG_PATH", undefined);
  vi.stubEnv("OPENCLAW_WORKSPACE_DIR", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(stateDir, { recursive: true, force: true });
});

describe("getWorkspaceAgent", () => {
  it("returns valid agent", () => {
    expect(getWorkspaceAgent("mail")).toBe("mail");
  });

  it("throws on null", () => {
    expect(() => getWorkspaceAgent(null)).toThrow();
  });

  it("throws on empty string", () => {
    expect(() => getWorkspaceAgent("")).toThrow();
  });
});

describe("getWorkspaceRoot", () => {
  it("uses a per-agent fallback under the state directory", () => {
    expect(getWorkspaceRoot("mail")).toBe(join(stateDir, "workspace-mail"));
  });

  it("uses the runtime workspace across asynchronous work", async () => {
    const result = await withWorkspaceConfig(
      { agents: { entries: { mail: { workspace: "~/mail-example" } } } },
      async () => {
        await Promise.resolve();
        return getWorkspaceRoot("mail");
      },
    );
    expect(result).toBe(join(homedir(), "mail-example"));
    expect(getWorkspaceRoot("mail")).toBe(join(stateDir, "workspace-mail"));
  });

  it("resolves the local JSON5 config for a standalone caller", () => {
    const cfg = join(stateDir, "custom.json");
    const workspace = join(stateDir, "custom-workspace");
    vi.stubEnv("OPENCLAW_CONFIG_PATH", cfg);
    writeFileSync(cfg, "{ agents: { list: [{ id: 'mail', workspace: " + JSON.stringify(workspace) + ", }], }, }");
    expect(getWorkspaceRoot("mail")).toBe(workspace);
  });

  it("normalizes agent IDs without using raw path components", () => {
    expect(getWorkspaceRoot("  MAIL Agent  ")).toBe(join(stateDir, "workspace-mail-agent"));
    expect(() => getWorkspaceRoot("...")).toThrow("Invalid workspace agent ID");
  });

  it("uses the implicit default agent workspace", () => {
    expect(getWorkspaceRoot("main")).toBe(join(stateDir, "workspace"));
  });

  it("uses the defaults root for the default agent and a subdirectory for others", () => {
    const root = join(stateDir, "shared");
    const config = { agents: { defaults: { workspace: root }, entries: { main: {}, mail: { default: true } } } };
    withWorkspaceConfig(config, () => {
      expect(getWorkspaceRoot("mail")).toBe(root);
      expect(getWorkspaceRoot("main")).toBe(join(root, "main"));
    });
  });

  it("fails clearly on malformed local config without including its text", () => {
    const cfg = join(stateDir, "openclaw.json");
    writeFileSync(cfg, "{ agent: malformed-fixture");
    expect(() => getWorkspaceRoot("mail")).toThrow(/^Could not read the OpenClaw workspace configuration$/);
  });

  it("preserves legacy rules, config and state until corresponding files exist in the configured workspace", () => {
    const legacy = join(stateDir, "agents", "mail", "workspace");
    const workspace = join(stateDir, "configured-mail");
    const files = [
      [getRulesFile, "usps-mail", "rules.json"],
      [getConfigFile, "usps-mail", "config.json"],
      [getAnalysisFile, "memory", "usps_analysis.json"],
      [getStateFile, "memory", "usps_state.json"],
    ] as const;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      withWorkspaceConfig({ agents: { entries: { mail: { workspace } } } }, () => {
        for (const [getFile, subdir, name] of files) {
          mkdirSync(join(legacy, subdir), { recursive: true });
          const oldFile = join(legacy, subdir, name);
          writeFileSync(oldFile, "{}");
          expect(getFile("mail")).toBe(oldFile);
          expect(getFile("mail")).toBe(oldFile);
          mkdirSync(join(workspace, subdir), { recursive: true });
          const newFile = join(workspace, subdir, name);
          writeFileSync(newFile, "{}");
          expect(getFile("mail")).toBe(newFile);
        }
      });
      expect(warn).toHaveBeenCalledTimes(files.length);
    } finally {
      warn.mockRestore();
    }
  });

  it("throws on null", () => {
    expect(() => getWorkspaceRoot(null)).toThrow();
  });
});

describe("derived paths", () => {
  it("memory dir ends with workspace-x/memory", () => {
    expect(getMemoryDir("x")).toMatch(/workspace-x\/memory$/);
  });

  it("long term memory dir ends with memory/mail", () => {
    expect(getLongTermMemoryDir("x")).toMatch(/memory\/mail$/);
  });

  it("usps dir ends with workspace-x/usps-mail", () => {
    expect(getUspsDir("x")).toMatch(/workspace-x\/usps-mail$/);
  });

  it("analysis file ends with memory/usps_analysis.json", () => {
    expect(getAnalysisFile("x")).toMatch(/memory\/usps_analysis\.json$/);
  });

  it("state file ends with memory/usps_state.json", () => {
    expect(getStateFile("x")).toMatch(/memory\/usps_state\.json$/);
  });

  it("rules file ends with usps-mail/rules.json", () => {
    expect(getRulesFile("x")).toMatch(/usps-mail\/rules\.json$/);
  });

  it("config file ends with usps-mail/config.json", () => {
    expect(getConfigFile("x")).toMatch(/usps-mail\/config\.json$/);
  });
});

describe("path consistency", () => {
  it("analysis file is under memory dir", () => {
    const mem = getMemoryDir("a");
    const ana = getAnalysisFile("a");
    expect(ana.startsWith(mem)).toBe(true);
  });

  it("state file is under memory dir", () => {
    const mem = getMemoryDir("a");
    const st = getStateFile("a");
    expect(st.startsWith(mem)).toBe(true);
  });

  it("rules file is under usps dir", () => {
    const usps = getUspsDir("a");
    const rf = getRulesFile("a");
    expect(rf.startsWith(usps)).toBe(true);
  });

  it("config file is under usps dir", () => {
    const usps = getUspsDir("a");
    const cf = getConfigFile("a");
    expect(cf.startsWith(usps)).toBe(true);
  });

  it("different agents produce different roots", () => {
    const r1 = getWorkspaceRoot("alpha");
    const r2 = getWorkspaceRoot("beta");
    expect(r1).not.toBe(r2);
  });
});
