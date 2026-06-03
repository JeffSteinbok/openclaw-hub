/**
 * Tests for the Obsidian Vault plugin.
 *
 * Uses a temporary directory with real files to test the full pipeline:
 * parsing, indexing, security, and tool handlers.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Test vault setup
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

beforeAll(() => {
  mkdirSync(VAULT_ROOT, { recursive: true });

  writeNote("Projects/Battery Monitoring.md", `---
title: Battery Monitoring
tags: [homeassistant, automation]
---

# Battery Monitoring

Monitor battery levels for all devices. See also [[Zigbee Devices]] and [[Home Dashboard|Dashboard]].

#monitoring #iot
`);

  writeNote("Projects/Zigbee Devices.md", `---
tags: homeassistant
---

# Zigbee Devices

List of Zigbee devices on the network. Related to [[Battery Monitoring]].

#networking #iot
`);

  writeNote("Projects/Home Dashboard.md", `---
title: Home Dashboard
---

# Home Dashboard

Central dashboard for Home Assistant. Links to [[Battery Monitoring]] and [[Zigbee Devices]].

\`\`\`javascript
// This #tag should be ignored
const x = "#notag";
\`\`\`

#homeassistant #dashboard
`);

  writeNote("Notes/Daily/2024-01-15.md", `# Daily Note

Today's tasks and observations.

#daily
`);

  writeNote("Notes/Recipes/Pasta.md", `---
title: Pasta Recipe
tag: cooking, food
---

# Pasta Recipe

A simple pasta recipe.
`);
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Parser tests
// ---------------------------------------------------------------------------

describe("parser", () => {
  it("extracts frontmatter", async () => {
    const { parseFrontmatter } = await import("../src/parser.js");
    const result = parseFrontmatter(`---
title: Test
tags: [a, b]
---

Content here.`);
    expect(result.frontmatter.title).toBe("Test");
    expect(result.frontmatter.tags).toEqual(["a", "b"]);
    expect(result.content.trim()).toBe("Content here.");
  });

  it("handles missing frontmatter", async () => {
    const { parseFrontmatter } = await import("../src/parser.js");
    const result = parseFrontmatter("# Just a heading\n\nSome content.");
    expect(result.frontmatter).toEqual({});
    expect(result.content).toContain("Just a heading");
  });

  it("extracts inline tags", async () => {
    const { extractTags } = await import("../src/parser.js");
    const tags = extractTags("Some text #alpha and #beta-test here", {});
    expect(tags).toContain("alpha");
    expect(tags).toContain("beta-test");
  });

  it("extracts frontmatter tags", async () => {
    const { extractTags } = await import("../src/parser.js");
    const tags = extractTags("No inline tags", { tags: ["FooBar", "baz"] });
    expect(tags).toContain("foobar");
    expect(tags).toContain("baz");
  });

  it("extracts comma-separated string tags", async () => {
    const { extractTags } = await import("../src/parser.js");
    const tags = extractTags("", { tag: "cooking, food" });
    expect(tags).toContain("cooking");
    expect(tags).toContain("food");
  });

  it("ignores tags inside code blocks", async () => {
    const { extractTags } = await import("../src/parser.js");
    const content = "Real #tag here\n```\n#fake\n```\nAnd `#inline_fake`";
    const tags = extractTags(content, {});
    expect(tags).toContain("tag");
    expect(tags).not.toContain("fake");
    expect(tags).not.toContain("inline_fake");
  });

  it("extracts wikilinks", async () => {
    const { extractWikilinks } = await import("../src/parser.js");
    const links = extractWikilinks("See [[Note A]] and [[Note B|alias]] and [[Note C#heading]].");
    expect(links).toHaveLength(3);
    expect(links[0]).toEqual({ target: "Note A", alias: null });
    expect(links[1]).toEqual({ target: "Note B", alias: "alias" });
    expect(links[2]).toEqual({ target: "Note C", alias: null });
  });

  it("deduplicates wikilinks", async () => {
    const { extractWikilinks } = await import("../src/parser.js");
    const links = extractWikilinks("[[Dup]] and [[Dup]] again.");
    expect(links).toHaveLength(1);
  });

  it("derives title from frontmatter", async () => {
    const { deriveTitle } = await import("../src/parser.js");
    expect(deriveTitle({ title: "My Title" }, "# Other", "file.md")).toBe("My Title");
  });

  it("derives title from H1", async () => {
    const { deriveTitle } = await import("../src/parser.js");
    expect(deriveTitle({}, "# Heading Title\n\nContent", "file.md")).toBe("Heading Title");
  });

  it("derives title from filename", async () => {
    const { deriveTitle } = await import("../src/parser.js");
    expect(deriveTitle({}, "No heading", "path/to/My Note.md")).toBe("My Note");
  });
});

// ---------------------------------------------------------------------------
// Security tests
// ---------------------------------------------------------------------------

describe("security", () => {
  it("resolves a valid path inside vault", async () => {
    const { resolveSafePath } = await import("../src/security.js");
    const result = resolveSafePath(VAULT_ROOT, "Projects/Battery Monitoring.md");
    expect(result).toBe(join(VAULT_ROOT, "Projects/Battery Monitoring.md"));
  });

  it("rejects path traversal with ../", async () => {
    const { resolveSafePath } = await import("../src/security.js");
    expect(() => resolveSafePath(VAULT_ROOT, "../../etc/passwd")).toThrow(/escapes vault root/);
  });

  it("rejects absolute paths", async () => {
    const { resolveSafePath } = await import("../src/security.js");
    expect(() => resolveSafePath(VAULT_ROOT, "/etc/passwd")).toThrow(/absolute paths/);
  });

  it("rejects null bytes", async () => {
    const { resolveSafePath } = await import("../src/security.js");
    expect(() => resolveSafePath(VAULT_ROOT, "file\0.md")).toThrow(/null bytes/);
  });

  it("rejects empty path", async () => {
    const { resolveSafePath } = await import("../src/security.js");
    expect(() => resolveSafePath(VAULT_ROOT, "")).toThrow(/empty/);
  });

  it("validates index location is outside vault", async () => {
    const { validateIndexLocation } = await import("../src/security.js");
    expect(() => validateIndexLocation(VAULT_ROOT, join(VAULT_ROOT, "index.db")))
      .toThrow(/must not be inside vault root/);
  });

  it("allows index location outside vault", async () => {
    const { validateIndexLocation } = await import("../src/security.js");
    expect(() => validateIndexLocation(VAULT_ROOT, INDEX_PATH)).not.toThrow();
  });

  it("rejects symlink escaping vault", async () => {
    const { resolveSafePath } = await import("../src/security.js");
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
// Indexer tests
// ---------------------------------------------------------------------------

describe("indexer", () => {
  let VaultIndex: typeof import("../src/indexer.js").VaultIndex;
  let index: InstanceType<typeof import("../src/indexer.js").VaultIndex>;

  beforeAll(async () => {
    const mod = await import("../src/indexer.js");
    VaultIndex = mod.VaultIndex;
    index = new VaultIndex({ vaultRoot: VAULT_ROOT, indexLocation: INDEX_PATH });
    await index.startIndexing();
  });

  afterAll(async () => {
    await index.close();
  });

  it("indexes all markdown files", () => {
    expect(index.getNoteCount()).toBe(5);
  });

  it("marks index as ready", () => {
    expect(index.ready).toBe(true);
  });

  it("searches for notes", () => {
    const results = index.search("battery", 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toContain("Battery Monitoring");
  });

  it("returns empty for no-match search", () => {
    const results = index.search("xyznonexistent123", 10);
    expect(results).toHaveLength(0);
  });

  it("reads a note by path", () => {
    const note = index.readNote("Projects/Battery Monitoring.md");
    expect(note).not.toBeNull();
    expect(note!.title).toBe("Battery Monitoring");
    expect(note!.content).toContain("Monitor battery levels");
  });

  it("returns null for nonexistent note", () => {
    const note = index.readNote("nonexistent.md");
    expect(note).toBeNull();
  });

  it("lists recent notes", () => {
    const recent = index.listRecent(3);
    expect(recent.length).toBeLessThanOrEqual(3);
    expect(recent.length).toBeGreaterThan(0);
    // All should have mtime
    for (const r of recent) {
      expect(r.mtime_ms).toBeGreaterThan(0);
    }
  });

  it("lists all tags", () => {
    const tags = index.listTags();
    expect(tags).toContain("homeassistant");
    expect(tags).toContain("iot");
    expect(tags).toContain("monitoring");
    expect(tags).toContain("daily");
    expect(tags).toContain("cooking");
  });

  it("does not include code-block tags", () => {
    const tags = index.listTags();
    expect(tags).not.toContain("notag");
  });

  it("finds backlinks", () => {
    const backlinks = index.getBacklinks("Battery Monitoring");
    expect(backlinks.length).toBeGreaterThanOrEqual(2);
    const paths = backlinks.map((b) => b.path);
    expect(paths).toContain("Projects/Zigbee Devices.md");
    expect(paths).toContain("Projects/Home Dashboard.md");
  });

  it("finds related notes", () => {
    const related = index.getRelatedNotes("Projects/Battery Monitoring.md");
    expect(related.length).toBeGreaterThan(0);
    const paths = related.map((r) => r.path);
    expect(paths).toContain("Projects/Zigbee Devices.md");
    // Each should have reasons
    for (const r of related) {
      expect(r.reasons.length).toBeGreaterThan(0);
    }
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

    // Cleanup the index db created during registration
    try { rmSync(INDEX_PATH + ".reg-test", { force: true }); } catch { /* ignore */ }
  });
});

// ---------------------------------------------------------------------------
// Handler tests (vault_read with security)
// ---------------------------------------------------------------------------

describe("vault_read handler", () => {
  it("reads a note successfully", async () => {
    const { handleRead } = await import("../src/handlers.js");
    const { VaultIndex } = await import("../src/indexer.js");
    const idx = new VaultIndex({
      vaultRoot: VAULT_ROOT,
      indexLocation: INDEX_PATH + ".read-test",
    });
    await idx.startIndexing();

    const result = handleRead(
      { vaultRoot: VAULT_ROOT, indexLocation: INDEX_PATH + ".read-test" },
      idx,
      "Notes/Recipes/Pasta.md",
    ) as { output: Record<string, unknown> };

    expect(result.output.title).toBe("Pasta Recipe");
    expect(result.output.tags).toContain("cooking");
    expect(result.output.tags).toContain("food");

    await idx.close();
    try { rmSync(INDEX_PATH + ".read-test", { force: true }); } catch { /* ignore */ }
  });

  it("rejects path traversal", async () => {
    const { handleRead } = await import("../src/handlers.js");
    const { VaultIndex } = await import("../src/indexer.js");
    const idx = new VaultIndex({
      vaultRoot: VAULT_ROOT,
      indexLocation: INDEX_PATH + ".trav-test",
    });

    const result = handleRead(
      { vaultRoot: VAULT_ROOT, indexLocation: INDEX_PATH + ".trav-test" },
      idx,
      "../../etc/passwd",
    ) as { error: string };

    expect(result.error).toContain("Access denied");

    await idx.close();
    try { rmSync(INDEX_PATH + ".trav-test", { force: true }); } catch { /* ignore */ }
  });

  it("returns error for nonexistent note", async () => {
    const { handleRead } = await import("../src/handlers.js");
    const { VaultIndex } = await import("../src/indexer.js");
    const idx = new VaultIndex({
      vaultRoot: VAULT_ROOT,
      indexLocation: INDEX_PATH + ".noent-test",
    });

    const result = handleRead(
      { vaultRoot: VAULT_ROOT, indexLocation: INDEX_PATH + ".noent-test" },
      idx,
      "nonexistent.md",
    ) as { error: string };

    expect(result.error).toContain("not found");

    await idx.close();
    try { rmSync(INDEX_PATH + ".noent-test", { force: true }); } catch { /* ignore */ }
  });
});
