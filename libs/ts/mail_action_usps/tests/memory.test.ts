import { describe, it, expect, vi } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import * as pathsMod from "../src/paths.js";
import {
  makeGuid,
  loadAnalysis,
  saveAnalysis,
  saveToAnalysis,
  writeMemoryForDate,
  lookup,
  getStats,
  loadState,
  saveState,
  updateState,
} from "../src/memory.js";

function patchPaths(td: string) {
  const memDir = join(td, "memory");
  mkdirSync(memDir, { recursive: true });
  const ltmDir = join(memDir, "mail");
  mkdirSync(ltmDir, { recursive: true });

  const analysisFile = join(memDir, "usps_analysis.json");
  const stateFile = join(memDir, "usps_state.json");

  const mocks = [
    vi.spyOn(pathsMod, "getAnalysisFile").mockReturnValue(analysisFile),
    vi.spyOn(pathsMod, "getLongTermMemoryDir").mockReturnValue(ltmDir),
    vi.spyOn(pathsMod, "getStateFile").mockReturnValue(stateFile),
  ];

  return { analysisFile, stateFile, ltmDir, mocks };
}

function cleanupMocks(mocks: ReturnType<typeof vi.spyOn>[]) {
  for (const m of mocks) m.mockRestore();
}

describe("makeGuid", () => {
  it("is deterministic", () => {
    const g1 = makeGuid("2024-01-15", "image001.jpg");
    const g2 = makeGuid("2024-01-15", "image001.jpg");
    expect(g1).toBe(g2);
  });

  it("differs for different filenames", () => {
    const g1 = makeGuid("2024-01-15", "image001.jpg");
    const g2 = makeGuid("2024-01-15", "image002.jpg");
    expect(g1).not.toBe(g2);
  });

  it("differs for different dates", () => {
    const g1 = makeGuid("2024-01-15", "image001.jpg");
    const g2 = makeGuid("2024-01-16", "image001.jpg");
    expect(g1).not.toBe(g2);
  });

  it("returns UUID format string", () => {
    const g = makeGuid("2024-01-15", "test.jpg");
    expect(typeof g).toBe("string");
    expect(g).toHaveLength(36);
  });
});

describe("analysis round-trip", () => {
  it("save and load", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-mem-"));
    const { mocks } = patchPaths(td);
    try {
      const data = {
        "2024-01-15": {
          "img001.jpg": { sender: "ACME", importance: "high" },
          "img002.jpg": { sender: "Bank", importance: "medium" },
        },
      };
      saveAnalysis(data, "test");
      const loaded = loadAnalysis("test");
      expect(loaded).toEqual(data);
    } finally {
      cleanupMocks(mocks);
    }
  });

  it("load empty returns {}", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-mem-"));
    const { mocks } = patchPaths(td);
    try {
      expect(loadAnalysis("test")).toEqual({});
    } finally {
      cleanupMocks(mocks);
    }
  });

  it("handles v2 format", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-mem-"));
    const { analysisFile, mocks } = patchPaths(td);
    try {
      const v2Data = {
        _meta: { version: 2 },
        data: {
          "2024-01-15": {
            "img001.jpg": { sender: "ACME", importance: "high" },
          },
        },
      };
      writeFileSync(analysisFile, JSON.stringify(v2Data));
      const loaded = loadAnalysis("test");
      expect(loaded["2024-01-15"]).toBeDefined();
      expect((loaded as Record<string, unknown>)["_meta"]).toBeUndefined();
    } finally {
      cleanupMocks(mocks);
    }
  });

  it("flat format filters _meta", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-mem-"));
    const { analysisFile, mocks } = patchPaths(td);
    try {
      const flatData = {
        _meta_version: "1.0",
        "2024-01-15": {
          "img001.jpg": { sender: "ACME" },
        },
      };
      writeFileSync(analysisFile, JSON.stringify(flatData));
      const loaded = loadAnalysis("test");
      expect(loaded["2024-01-15"]).toBeDefined();
      expect((loaded as Record<string, unknown>)["_meta_version"]).toBeUndefined();
    } finally {
      cleanupMocks(mocks);
    }
  });
});

describe("saveToAnalysis", () => {
  it("merges data", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-mem-"));
    const { mocks } = patchPaths(td);
    try {
      saveToAnalysis("2024-01-15", { "img001.jpg": { sender: "A" } }, "test");
      saveToAnalysis("2024-01-15", { "img002.jpg": { sender: "B" } }, "test");
      const loaded = loadAnalysis("test");
      expect(Object.keys(loaded["2024-01-15"])).toHaveLength(2);
    } finally {
      cleanupMocks(mocks);
    }
  });
});

describe("writeMemoryForDate", () => {
  it("creates file with content", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-mem-"));
    const { mocks } = patchPaths(td);
    try {
      const items = [
        { sender: "ACME", addressee: "Jeff", importance: "high", description: "Invoice" },
      ];
      const result = writeMemoryForDate("2024-01-15", items, "test");
      const content = readFileSync(result, "utf-8");
      expect(content).toContain("ACME");
      expect(content).toContain("Jeff");
      expect(content).toContain("2024-01-15");
    } finally {
      cleanupMocks(mocks);
    }
  });

  it("is idempotent", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-mem-"));
    const { ltmDir, mocks } = patchPaths(td);
    try {
      const items = [{ sender: "ACME", addressee: "Jeff", importance: "high" }];
      writeMemoryForDate("2024-01-15", items, "test");
      writeMemoryForDate("2024-01-15", items, "test");
      const content = readFileSync(join(ltmDir, "mail_memory_2024-01.md"), "utf-8");
      const count = (content.match(/2024-01-15/g) ?? []).length;
      expect(count).toBe(1);
    } finally {
      cleanupMocks(mocks);
    }
  });
});

describe("lookup", () => {
  function setupData(td: string) {
    const { mocks } = patchPaths(td);
    const data = {
      "2024-01-15": {
        "img001.jpg": { sender: "ACME", importance: "high", guid: makeGuid("2024-01-15", "img001.jpg") },
        "img002.jpg": { sender: "Bank", importance: "medium" },
      },
      "2024-01-16": {
        "img003.jpg": { sender: "IRS", importance: "urgent" },
      },
    };
    saveAnalysis(data, "test");
    return mocks;
  }

  it("lookup by date", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-mem-"));
    const mocks = setupData(td);
    try {
      const results = lookup({ date: "2024-01-15", workspaceAgent: "test" });
      expect(results).toHaveLength(2);
    } finally {
      cleanupMocks(mocks);
    }
  });

  it("lookup by search", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-mem-"));
    const mocks = setupData(td);
    try {
      const results = lookup({ search: "irs", workspaceAgent: "test" });
      expect(results).toHaveLength(1);
      expect(results[0].info.sender).toBe("IRS");
    } finally {
      cleanupMocks(mocks);
    }
  });

  it("lookup by guid", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-mem-"));
    const mocks = setupData(td);
    try {
      const targetGuid = makeGuid("2024-01-15", "img001.jpg");
      const results = lookup({ guid: targetGuid, workspaceAgent: "test" });
      expect(results).toHaveLength(1);
      expect(results[0].info.sender).toBe("ACME");
    } finally {
      cleanupMocks(mocks);
    }
  });

  it("lookup no match", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-mem-"));
    const mocks = setupData(td);
    try {
      const results = lookup({ search: "nonexistent", workspaceAgent: "test" });
      expect(results).toHaveLength(0);
    } finally {
      cleanupMocks(mocks);
    }
  });

  it("requires workspace_agent", () => {
    expect(() => lookup({ search: "test" })).toThrow();
  });
});

describe("getStats", () => {
  it("computes stats", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-mem-"));
    const { mocks } = patchPaths(td);
    try {
      const data = {
        "2024-01-15": {
          "img001.jpg": { sender: "ACME", addressee: "Jeff", importance: "high" },
          "img002.jpg": { sender: "ACME", addressee: "Nicole", importance: "junk" },
        },
        "2024-01-16": {
          "img003.jpg": { sender: "IRS", addressee: "Jeff", importance: "urgent" },
        },
      };
      saveAnalysis(data, "test");
      const stats = getStats("test");
      expect(stats.total_pieces).toBe(3);
      expect(stats.delivery_days).toBe(2);
      expect(stats.by_importance.high).toBe(1);
      expect(stats.by_importance.junk).toBe(1);
      expect(stats.top_senders.ACME).toBe(2);
      expect(stats.top_addressees.Jeff).toBe(2);
    } finally {
      cleanupMocks(mocks);
    }
  });

  it("empty stats", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-mem-"));
    const { mocks } = patchPaths(td);
    try {
      const stats = getStats("test");
      expect(stats.total_pieces).toBe(0);
      expect(stats.delivery_days).toBe(0);
    } finally {
      cleanupMocks(mocks);
    }
  });

  it("requires workspace_agent", () => {
    expect(() => getStats()).toThrow();
  });
});

describe("state round-trip", () => {
  it("save and load", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-mem-"));
    const { mocks } = patchPaths(td);
    try {
      const state = { last_checked_at: "2024-01-15T12:00:00Z", last_message_id: "abc123" };
      saveState(state, "test");
      const loaded = loadState("test");
      expect(loaded).toEqual(state);
    } finally {
      cleanupMocks(mocks);
    }
  });

  it("load missing returns {}", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-mem-"));
    const { mocks } = patchPaths(td);
    try {
      expect(loadState("test")).toEqual({});
    } finally {
      cleanupMocks(mocks);
    }
  });

  it("updateState", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-mem-"));
    const { mocks } = patchPaths(td);
    try {
      updateState({
        lastCheckedAt: "2024-01-15T12:00:00Z",
        messageId: "msg001",
        dateProcessed: "2024-01-15",
        workspaceAgent: "test",
      });
      const state = loadState("test");
      expect(state.last_checked_at).toBe("2024-01-15T12:00:00Z");
      expect(state.last_message_id).toBe("msg001");
      expect(state.processed_message_ids as string[]).toContain("msg001");
      expect(state.last_date_processed).toBe("2024-01-15");
    } finally {
      cleanupMocks(mocks);
    }
  });

  it("updateState dedup", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-mem-"));
    const { mocks } = patchPaths(td);
    try {
      updateState({ messageId: "msg001", workspaceAgent: "test" });
      updateState({ messageId: "msg001", workspaceAgent: "test" });
      const state = loadState("test");
      const ids = state.processed_message_ids as string[];
      expect(ids.filter((id: string) => id === "msg001")).toHaveLength(1);
    } finally {
      cleanupMocks(mocks);
    }
  });

  it("requires workspace_agent", () => {
    expect(() => updateState({ lastCheckedAt: "now" })).toThrow();
  });
});
