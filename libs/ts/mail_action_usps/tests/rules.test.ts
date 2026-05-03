import { describe, it, expect, vi } from "vitest";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import * as pathsMod from "../src/paths.js";
import {
  loadRules,
  saveRules,
  applyRules,
  addRule,
  removeRule,
  testRule,
  listRules,
} from "../src/rules.js";

describe("loadRules", () => {
  it("missing file returns empty", () => {
    const [rules, version] = loadRules({ rulesPath: "/nonexistent/path/rules.json" });
    expect(rules).toEqual([]);
    expect(version).toBe("0");
  });

  it("valid dict format", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-rules-"));
    const path = join(td, "rules.json");
    writeFileSync(
      path,
      JSON.stringify({
        version: "2.3",
        rules: [{ addressee_contains: "smith", importance: "low" }],
      }),
    );
    const [rules, version] = loadRules({ rulesPath: path });
    expect(rules).toHaveLength(1);
    expect(version).toBe("2.3");
    expect(rules[0].importance).toBe("low");
  });

  it("flat list format", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-rules-"));
    const path = join(td, "rules.json");
    writeFileSync(
      path,
      JSON.stringify([{ addressee_contains: "x", importance: "high" }]),
    );
    const [rules, version] = loadRules({ rulesPath: path });
    expect(rules).toHaveLength(1);
    expect(version).toBe("0");
  });

  it("no path no agent throws", () => {
    expect(() => loadRules()).toThrow();
  });
});

describe("save and load round-trip", () => {
  it("round trip", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-rules-"));
    const path = join(td, "rules.json");
    const rules = [{ sender_contains: "acme", importance: "junk", _comment: "Acme junk" }];
    saveRules(rules, "3.1", { rulesPath: path });

    const [loaded, ver] = loadRules({ rulesPath: path });
    expect(ver).toBe("3.1");
    expect(loaded).toHaveLength(1);
    expect(loaded[0].sender_contains).toBe("acme");
  });
});

describe("applyRules", () => {
  it("no rules returns original", () => {
    const info = { sender: "ACME", importance: "medium" };
    const result = applyRules(info, []);
    expect(result.importance).toBe("medium");
  });

  it("contains match", () => {
    const rules = [{ sender_contains: "acme", importance: "junk" }];
    const result = applyRules({ sender: "ACME Corp", importance: "medium" }, rules);
    expect(result.importance).toBe("junk");
  });

  it("contains no match", () => {
    const rules = [{ sender_contains: "xyz", importance: "junk" }];
    const result = applyRules({ sender: "ACME Corp", importance: "medium" }, rules);
    expect(result.importance).toBe("medium");
  });

  it("not_contains match", () => {
    const rules = [{ sender_not_contains: "acme", importance: "high" }];
    const result = applyRules({ sender: "Bank of America", importance: "medium" }, rules);
    expect(result.importance).toBe("high");
  });

  it("not_contains no match", () => {
    const rules = [{ sender_not_contains: "bank", importance: "high" }];
    const result = applyRules({ sender: "Bank of America", importance: "medium" }, rules);
    expect(result.importance).toBe("medium");
  });

  it("equals match", () => {
    const rules = [{ mail_class_equals: "first-class", importance: "high" }];
    const result = applyRules({ mail_class: "First-Class", importance: "medium" }, rules);
    expect(result.importance).toBe("high");
  });

  it("equals no match", () => {
    const rules = [{ mail_class_equals: "first-class", importance: "high" }];
    const result = applyRules({ mail_class: "Standard", importance: "medium" }, rules);
    expect(result.importance).toBe("medium");
  });

  it("not_equals match", () => {
    const rules = [{ mail_class_not_equals: "standard", importance: "high" }];
    const result = applyRules({ mail_class: "First-Class", importance: "medium" }, rules);
    expect(result.importance).toBe("high");
  });

  it("not_equals no match", () => {
    const rules = [{ mail_class_not_equals: "first-class", importance: "high" }];
    const result = applyRules({ mail_class: "First-Class", importance: "medium" }, rules);
    expect(result.importance).toBe("medium");
  });

  it("first match wins", () => {
    const rules = [
      { sender_contains: "acme", importance: "low" },
      { sender_contains: "acme", importance: "high" },
    ];
    const result = applyRules({ sender: "ACME Corp" }, rules);
    expect(result.importance).toBe("low");
  });

  it("multiple conditions AND", () => {
    const rules = [{ sender_contains: "acme", addressee_contains: "jeff", importance: "urgent" }];
    const matchResult = applyRules({ sender: "ACME Corp", addressee: "Jeff Smith" }, rules);
    expect(matchResult.importance).toBe("urgent");
    const partialResult = applyRules({ sender: "ACME Corp", addressee: "Nicole Smith" }, rules);
    expect(partialResult.importance).not.toBe("urgent");
  });

  it("comment field ignored", () => {
    const rules = [{ _comment: "test rule", sender_contains: "acme", importance: "junk" }];
    const result = applyRules({ sender: "ACME Corp" }, rules);
    expect(result.importance).toBe("junk");
  });

  it("does not mutate original", () => {
    const rules = [{ sender_contains: "acme", importance: "junk" }];
    const info = { sender: "ACME Corp", importance: "medium" };
    const result = applyRules(info, rules);
    expect(info.importance).toBe("medium");
    expect(result.importance).toBe("junk");
  });
});

describe("addRule and removeRule", () => {
  function setupDir() {
    const td = mkdtempSync(join(tmpdir(), "usps-rules-"));
    mkdirSync(join(td, "usps-mail"), { recursive: true });
    const rulesPath = join(td, "usps-mail", "rules.json");
    const mock = vi.spyOn(pathsMod, "getRulesFile").mockReturnValue(rulesPath);
    return { td, rulesPath, mock };
  }

  it("add bumps version", () => {
    const { mock } = setupDir();
    try {
      const result = addRule({ sender_contains: "acme" }, "junk", {
        comment: "Block ACME",
        workspaceAgent: "test",
      });
      expect(result.action).toBe("added");
      expect(result.version).toBe("1.0");
      expect(result.rule_index).toBe(0);

      const result2 = addRule({ sender_contains: "xyz" }, "low", {
        workspaceAgent: "test",
      });
      expect(result2.version).toBe("1.1");
      expect(result2.rule_index).toBe(1);
    } finally {
      mock.mockRestore();
    }
  });

  it("remove by index", () => {
    const { rulesPath, mock } = setupDir();
    try {
      addRule({ sender_contains: "a" }, "low", { comment: "Rule A", workspaceAgent: "test" });
      addRule({ sender_contains: "b" }, "high", { comment: "Rule B", workspaceAgent: "test" });

      const result = removeRule({ index: 0, workspaceAgent: "test" });
      expect(result.action).toBe("removed");
      expect(result.rule!.sender_contains).toContain("a");

      const [rules] = loadRules({ rulesPath });
      expect(rules).toHaveLength(1);
    } finally {
      mock.mockRestore();
    }
  });

  it("remove by comment", () => {
    const { rulesPath, mock } = setupDir();
    try {
      addRule({ sender_contains: "a" }, "low", { comment: "Block spam A", workspaceAgent: "test" });
      addRule({ sender_contains: "b" }, "high", { comment: "Allow B", workspaceAgent: "test" });

      const result = removeRule({ commentMatch: "spam", workspaceAgent: "test" });
      expect(result.action).toBe("removed");

      const [rules] = loadRules({ rulesPath });
      expect(rules).toHaveLength(1);
      expect(rules[0]._comment).toBe("Allow B");
    } finally {
      mock.mockRestore();
    }
  });

  it("remove not found", () => {
    const { mock } = setupDir();
    try {
      const result = removeRule({ index: 99, workspaceAgent: "test" });
      expect(result.action).toBe("not_found");
    } finally {
      mock.mockRestore();
    }
  });
});

describe("testRule", () => {
  it("matched", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-rules-"));
    const rulesPath = join(td, "rules.json");
    saveRules([{ sender_contains: "acme", importance: "junk" }], "1.0", { rulesPath });

    const mock = vi.spyOn(pathsMod, "getRulesFile").mockReturnValue(rulesPath);
    try {
      const result = testRule({ sender: "ACME Corp", importance: "medium" }, "test");
      expect(result.rule_matched).toBe(true);
      expect(result.final_importance).toBe("junk");
    } finally {
      mock.mockRestore();
    }
  });

  it("not matched", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-rules-"));
    const rulesPath = join(td, "rules.json");
    saveRules([{ sender_contains: "xyz", importance: "junk" }], "1.0", { rulesPath });

    const mock = vi.spyOn(pathsMod, "getRulesFile").mockReturnValue(rulesPath);
    try {
      const result = testRule({ sender: "ACME Corp", importance: "medium" }, "test");
      expect(result.rule_matched).toBe(false);
      expect(result.final_importance).toBe("medium");
    } finally {
      mock.mockRestore();
    }
  });
});

describe("listRules", () => {
  it("returns summary", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-rules-"));
    const rulesPath = join(td, "rules.json");
    saveRules(
      [
        { sender_contains: "acme", importance: "junk", _comment: "Block ACME" },
        { addressee_equals: "jeff", importance: "high" },
      ],
      "2.0",
      { rulesPath },
    );

    const mock = vi.spyOn(pathsMod, "getRulesFile").mockReturnValue(rulesPath);
    try {
      const result = listRules("test");
      expect(result.version).toBe("2.0");
      expect(result.count).toBe(2);
      expect(result.rules[0].comment).toBe("Block ACME");
      expect(result.rules[0].importance).toBe("junk");
      expect(result.rules[0].conditions.sender_contains).toBeDefined();
      expect(result.rules[1].comment).toBe("");
    } finally {
      mock.mockRestore();
    }
  });
});
