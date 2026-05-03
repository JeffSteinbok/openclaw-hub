import { describe, it, expect } from "vitest";
import { homedir } from "node:os";

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
} from "../src/paths.js";

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
  it("returns path ending with agents/mail/workspace", () => {
    const p = getWorkspaceRoot("mail");
    expect(p).toMatch(/agents\/mail\/workspace$/);
  });

  it("contains .openclaw", () => {
    const p = getWorkspaceRoot("mail");
    expect(p).toContain(".openclaw");
  });

  it("throws on null", () => {
    expect(() => getWorkspaceRoot(null)).toThrow();
  });
});

describe("derived paths", () => {
  it("memory dir ends with workspace/memory", () => {
    expect(getMemoryDir("x")).toMatch(/workspace\/memory$/);
  });

  it("long term memory dir ends with memory/mail", () => {
    expect(getLongTermMemoryDir("x")).toMatch(/memory\/mail$/);
  });

  it("usps dir ends with workspace/usps-mail", () => {
    expect(getUspsDir("x")).toMatch(/workspace\/usps-mail$/);
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
