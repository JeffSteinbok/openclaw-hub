/**
 * Tests for the Obsidian Vault plugin.
 *
 * Uses a temporary directory with real files and a pre-built index
 * to test the read-only VaultReader and tool handlers.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { initSchema, parseNote } from "@openclaw/obsidian-core";

// ---------------------------------------------------------------------------
// Test vault setup — build a real index, then test read-only access
// ---------------------------------------------------------------------------

const TEST_ROOT = join(tmpdir(), `obsidian-vault-test-${Date.now()}`);
const VAULT_ROOT = join(TEST_ROOT, "vault");
const INDEX_PATH = join(TEST_ROOT, "index.db");

function writeNote(relPath: string, content: string): void {
  const abs = join(VAULT_ROOT, relPath);
  const dir = abs.substring(0, abs.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(abs, content, "utf-8");
}

function indexNote(db: Database.Database, relPath: string, content: string): void {
  const parsed = parseNote(content, relPath);
  const stat = { mtimeMs: Date.now() };

  db.prepare(
    "INSERT OR REPLACE INTO notes (path, title, content, frontmatter_json, mtime_ms) VALUES (?, ?, ?, ?, ?)"
  ).run(relPath, parsed.title, parsed.content, JSON.stringify(parsed.frontmatter), stat.mtimeMs);

  const deleteTags = db.prepare("DELETE FROM tags WHERE note_path = ?");
  const insertTag = db.prepare("INSERT OR REPLACE INTO tags (note_path, tag) VALUES (?, ?)");
  deleteTags.run(relPath);
  for (const tag of parsed.tags) {
    insertTag.run(relPath, tag);
  }

  const deleteLinks = db.prepare("DELETE FROM links WHERE source_path = ?");
  const insertLink = db.prepare("INSERT INTO links (source_path, target, alias) VALUES (?, ?, ?)");
  deleteLinks.run(relPath);
  for (const link of parsed.wikilinks) {
    insertLink.run(relPath, link.target, link.alias);
  }
}

const NOTES: Record<string, string> = {
  "Projects/Battery Monitoring.md": `---
title: Battery Monitoring
tags: [homeassistant, automation]
---

# Battery Monitoring

Monitor battery levels for all devices. See also [[Zigbee Devices]] and [[Home Dashboard|Dashboard]].

#monitoring #iot
`,
  "Projects/Zigbee Devices.md": `---
tags: homeassistant
---

# Zigbee Devices

List of Zigbee devices on the network. Related to [[Battery Monitoring]].

#networking #iot
`,
  "Projects/Home Dashboard.md": `---
title: Home Dashboard
---

# Home Dashboard

Central dashboard for Home Assistant. Links to [[Battery Monitoring]] and [[Zigbee Devices]].

\`\`\`javascript
// This #tag should be ignored
const x = "#notag";
\`\`\`

#homeassistant #dashboard
`,
  "Notes/Daily/2024-01-15.md": `# Daily Note

Today's tasks and observations.

#daily
`,
  "Notes/Recipes/Pasta.md": `---
title: Pasta Recipe
tag: cooking, food
---

# Pasta Recipe

A simple pasta recipe.
`,
  "Reference/Appliances.md": `---
title: Appliances
---

# Appliances

Washing Machine
LG WM3900HWA

Washer/Dryer combo available.

Dryer
LG: DLEX3900W
`,
};

beforeAll(() => {
  mkdirSync(VAULT_ROOT, { recursive: true });

  // Write vault files
  for (const [path, content] of Object.entries(NOTES)) {
    writeNote(path, content);
  }

  // Build the index (as the indexer service would)
  const db = new Database(INDEX_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);

  for (const [path, content] of Object.entries(NOTES)) {
    indexNote(db, path, content);
  }

  db.close();
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Parser tests (from obsidian-core — quick smoke test)
// ---------------------------------------------------------------------------

describe("parser (via obsidian-core)", () => {
  it("extracts frontmatter", async () => {
    const { parseFrontmatter } = await import("@openclaw/obsidian-core");
    const result = parseFrontmatter(`---
title: Test
tags: [a, b]
---

Content here.`);
    expect(result.frontmatter.title).toBe("Test");
    expect(result.frontmatter.tags).toEqual(["a", "b"]);
    expect(result.content.trim()).toBe("Content here.");
  });
});

// ---------------------------------------------------------------------------
// Security tests (from obsidian-core — quick smoke test)
// ---------------------------------------------------------------------------

describe("security (via obsidian-core)", () => {
  it("resolves a valid path inside vault", async () => {
    const { resolveSafePath } = await import("@openclaw/obsidian-core");
    const result = resolveSafePath(VAULT_ROOT, "Projects/Battery Monitoring.md");
    expect(result).toBe(join(VAULT_ROOT, "Projects/Battery Monitoring.md"));
  });

  it("rejects path traversal with ../", async () => {
    const { resolveSafePath } = await import("@openclaw/obsidian-core");
    expect(() => resolveSafePath(VAULT_ROOT, "../../etc/passwd")).toThrow(/escapes vault root/);
  });

  it("rejects absolute paths", async () => {
    const { resolveSafePath } = await import("@openclaw/obsidian-core");
    expect(() => resolveSafePath(VAULT_ROOT, "/etc/passwd")).toThrow(/absolute paths/);
  });

  it("rejects null bytes", async () => {
    const { resolveSafePath } = await import("@openclaw/obsidian-core");
    expect(() => resolveSafePath(VAULT_ROOT, "file\0.md")).toThrow(/null bytes/);
  });

  it("rejects empty path", async () => {
    const { resolveSafePath } = await import("@openclaw/obsidian-core");
    expect(() => resolveSafePath(VAULT_ROOT, "")).toThrow(/empty/);
  });

  it("validates index location is outside vault", async () => {
    const { validateIndexLocation } = await import("@openclaw/obsidian-core");
    expect(() => validateIndexLocation(VAULT_ROOT, join(VAULT_ROOT, "index.db")))
      .toThrow(/must not be inside vault root/);
  });

  it("allows index location outside vault", async () => {
    const { validateIndexLocation } = await import("@openclaw/obsidian-core");
    expect(() => validateIndexLocation(VAULT_ROOT, INDEX_PATH)).not.toThrow();
  });

  it("rejects symlink escaping vault", async () => {
    const { resolveSafePath } = await import("@openclaw/obsidian-core");
    const linkPath = join(VAULT_ROOT, "escape-link.md");
    try {
      symlinkSync("/etc/hostname", linkPath);
      expect(() => resolveSafePath(VAULT_ROOT, "escape-link.md")).toThrow(/escapes vault root/);
    } finally {
      try { rmSync(linkPath); } catch { /* ignore */ }
    }
  });
});

// ---------------------------------------------------------------------------
// VaultReader tests (read-only query)
// ---------------------------------------------------------------------------

describe("VaultReader", () => {
  let VaultReader: typeof import("../src/reader.js").VaultReader;
  let reader: InstanceType<typeof import("../src/reader.js").VaultReader>;

  beforeAll(async () => {
    const mod = await import("../src/reader.js");
    VaultReader = mod.VaultReader;
    reader = new VaultReader(INDEX_PATH);
  });

  afterAll(() => {
    reader?.close();
  });

  it("reports ready status", () => {
    expect(reader.ready).toBe(true);
    const status = reader.getStatus();
    expect(status.state).toBe("ready");
  });

  it("searches for notes via FTS5", () => {
    const results = reader.search("battery", 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toContain("Battery Monitoring");
  });

  it("prefix-matches partial words", () => {
    const results = reader.search("batter", 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toContain("Battery Monitoring");
  });

  it("preserves explicit FTS5 operators", () => {
    const results = reader.search("battery OR pasta", 10);
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it("falls back to LIKE for no FTS match", () => {
    const results = reader.search("#iot", 10);
    expect(results.length).toBeGreaterThan(0);
  });

  it("searches for LG appliances", () => {
    const results = reader.search("LG", 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.path.includes("Appliances"))).toBe(true);
  });

  it("searches for washer", () => {
    const results = reader.search("washer", 10);
    expect(results.length).toBeGreaterThan(0);
  });

  it("searches for washing machine", () => {
    const results = reader.search("washing machine", 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.path.includes("Appliances"))).toBe(true);
  });

  it("returns empty for no-match search", () => {
    const results = reader.search("xyznonexistent123", 10);
    expect(results).toHaveLength(0);
  });

  it("reads a note by path", () => {
    const note = reader.readNote("Projects/Battery Monitoring.md");
    expect(note).not.toBeNull();
    expect(note!.title).toBe("Battery Monitoring");
    expect(note!.content).toContain("Monitor battery levels");
  });

  it("returns null for nonexistent note", () => {
    const note = reader.readNote("nonexistent.md");
    expect(note).toBeNull();
  });

  it("lists recent notes", () => {
    const recent = reader.listRecent(3);
    expect(recent.length).toBeLessThanOrEqual(3);
    expect(recent.length).toBeGreaterThan(0);
    for (const r of recent) {
      expect(r.mtime_ms).toBeGreaterThan(0);
    }
  });

  it("lists all tags", () => {
    const tags = reader.listTags();
    expect(tags).toContain("homeassistant");
    expect(tags).toContain("iot");
    expect(tags).toContain("monitoring");
    expect(tags).toContain("daily");
    expect(tags).toContain("cooking");
  });

  it("does not include code-block tags", () => {
    const tags = reader.listTags();
    expect(tags).not.toContain("notag");
  });

  it("finds backlinks", () => {
    const backlinks = reader.getBacklinks("Battery Monitoring");
    expect(backlinks.length).toBeGreaterThanOrEqual(2);
    const paths = backlinks.map((b) => b.path);
    expect(paths).toContain("Projects/Zigbee Devices.md");
    expect(paths).toContain("Projects/Home Dashboard.md");
  });

  it("finds related notes", () => {
    const related = reader.getRelatedNotes("Projects/Battery Monitoring.md");
    expect(related.length).toBeGreaterThan(0);
    const paths = related.map((r) => r.path);
    expect(paths).toContain("Projects/Zigbee Devices.md");
    for (const r of related) {
      expect(r.reasons.length).toBeGreaterThan(0);
    }
  });

  it("returns note count", () => {
    expect(reader.getNoteCount()).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// VaultReader — missing/empty index
// ---------------------------------------------------------------------------

describe("VaultReader (missing index)", () => {
  it("reports index_missing when DB doesn't exist", async () => {
    const { VaultReader } = await import("../src/reader.js");
    const reader = new VaultReader("/nonexistent/path/index.db");
    const status = reader.getStatus();
    expect(status.state).toBe("index_missing");
    expect(reader.ready).toBe(false);
    // Should return empty results, not throw
    expect(reader.search("test")).toEqual([]);
    expect(reader.listTags()).toEqual([]);
    expect(reader.readNote("test.md")).toBeNull();
    reader.close();
  });

  it("reports index_empty when DB has schema but no notes", async () => {
    const { VaultReader } = await import("../src/reader.js");
    const emptyIndex = join(TEST_ROOT, "empty.db");
    const db = new Database(emptyIndex);
    db.pragma("journal_mode = WAL");
    initSchema(db);
    db.close();

    const reader = new VaultReader(emptyIndex);
    const status = reader.getStatus();
    expect(status.state).toBe("index_empty");
    expect(reader.ready).toBe(false);
    reader.close();
  });

  it("reports schema_incompatible when version doesn't match", async () => {
    const { VaultReader } = await import("../src/reader.js");
    const badIndex = join(TEST_ROOT, "bad-version.db");
    const db = new Database(badIndex);
    db.pragma("user_version = 999");
    db.exec("CREATE TABLE IF NOT EXISTS notes (path TEXT PRIMARY KEY, title TEXT, content TEXT, frontmatter_json TEXT, mtime_ms INTEGER)");
    db.exec("INSERT INTO notes VALUES ('test.md', 'Test', 'content', '{}', 0)");
    db.close();

    const reader = new VaultReader(badIndex);
    const status = reader.getStatus();
    expect(status.state).toBe("schema_incompatible");
    reader.close();
  });
});

// ---------------------------------------------------------------------------
// Plugin tool registration
// ---------------------------------------------------------------------------

describe("plugin entry", () => {
  it("has correct id and name", async () => {
    const { createEntry } = await import("../src/index.js");
    const entry = createEntry();
    expect(entry.id).toBe("obsidian-vault");
    expect(entry.name).toBe("Obsidian Vault");
  });

  it("declares all expected tools in contracts", async () => {
    const { createEntry } = await import("../src/index.js");
    const entry = createEntry();
    expect(entry.contracts.tools.sort()).toEqual([
      "vault_backlinks",
      "vault_read",
      "vault_recent",
      "vault_related",
      "vault_search",
      "vault_tags",
    ]);
  });

  it("throws when vaultRoot is not provided", async () => {
    const { createEntry } = await import("../src/index.js");
    const entry = createEntry();
    const api = {
      pluginConfig: {},
      registerTool: () => {},
    };
    expect(() => entry.register(api)).toThrow(/vaultRoot/);
  });

  it("registers all tools when valid config is provided", async () => {
    const { createEntry } = await import("../src/index.js");
    const entry = createEntry();
    const tools: Record<string, unknown> = {};
    const api = {
      pluginConfig: {
        vaultRoot: VAULT_ROOT,
        indexLocation: INDEX_PATH + ".reg-test",
      },
      registerTool: (tool: { name: string }) => {
        tools[tool.name] = tool;
      },
    };

    entry.register(api);

    expect(Object.keys(tools).sort()).toEqual([
      "vault_backlinks",
      "vault_read",
      "vault_recent",
      "vault_related",
      "vault_search",
      "vault_tags",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Handler tests (vault_read with security)
// ---------------------------------------------------------------------------

describe("vault_read handler", () => {
  it("reads a note successfully", async () => {
    const { handleRead } = await import("../src/handlers.js");

    const result = handleRead(
      { vaultRoot: VAULT_ROOT, indexLocation: INDEX_PATH },
      "Notes/Recipes/Pasta.md",
    ) as { output: Record<string, unknown> };

    expect(result.output.title).toBe("Pasta Recipe");
    expect(result.output.tags).toContain("cooking");
    expect(result.output.tags).toContain("food");
  });

  it("rejects path traversal", async () => {
    const { handleRead } = await import("../src/handlers.js");

    const result = handleRead(
      { vaultRoot: VAULT_ROOT, indexLocation: INDEX_PATH },
      "../../etc/passwd",
    ) as { error: string };

    expect(result.error).toContain("Access denied");
  });

  it("returns error for nonexistent note", async () => {
    const { handleRead } = await import("../src/handlers.js");

    const result = handleRead(
      { vaultRoot: VAULT_ROOT, indexLocation: INDEX_PATH },
      "nonexistent.md",
    ) as { error: string };

    expect(result.error).toContain("not found");
  });
});
