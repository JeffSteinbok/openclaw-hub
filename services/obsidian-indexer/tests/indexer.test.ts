/**
 * Tests for the obsidian-indexer service.
 *
 * Uses a temporary vault directory with real files to test the full
 * indexing pipeline: scan, reconciliation, file watching, and shutdown.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, unlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { VaultIndexer } from "../src/indexer.js";

// ---------------------------------------------------------------------------
// Test vault setup
// ---------------------------------------------------------------------------

const TEST_ROOT = join(tmpdir(), `obsidian-indexer-test-${Date.now()}`);
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

  writeNote("Reference/Appliances.md", `---
title: Appliances
---

# Appliances

Washing Machine
LG WM3900HWA

Dryer
LG: DLEX3900W
`);
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Full scan tests
// ---------------------------------------------------------------------------

describe("full scan", () => {
  let indexer: VaultIndexer;

  afterAll(async () => {
    await indexer?.shutdown();
  });

  it("indexes all markdown files on startup", async () => {
    indexer = new VaultIndexer({ vaultRoot: VAULT_ROOT, indexLocation: INDEX_PATH });
    await indexer.start();

    expect(indexer.getNoteCount()).toBe(6);
  });

  it("creates FTS5 index entries", async () => {
    const db = new Database(INDEX_PATH, { readonly: true });
    const results = db
      .prepare(
        "SELECT n.title FROM notes_fts JOIN notes n ON n.rowid = notes_fts.rowid WHERE notes_fts MATCH 'battery'"
      )
      .all() as { title: string }[];

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe("Battery Monitoring");
    db.close();
  });

  it("indexes tags correctly", async () => {
    const db = new Database(INDEX_PATH, { readonly: true });
    const tags = db
      .prepare("SELECT DISTINCT tag FROM tags ORDER BY tag")
      .all() as { tag: string }[];
    const tagNames = tags.map((t) => t.tag);

    expect(tagNames).toContain("homeassistant");
    expect(tagNames).toContain("iot");
    expect(tagNames).toContain("monitoring");
    expect(tagNames).toContain("cooking");
    expect(tagNames).toContain("daily");
    // Code block tag should be excluded
    expect(tagNames).not.toContain("notag");
    db.close();
  });

  it("indexes wikilinks correctly", async () => {
    const db = new Database(INDEX_PATH, { readonly: true });
    const links = db
      .prepare("SELECT source_path, target, alias FROM links WHERE source_path = ?")
      .all("Projects/Battery Monitoring.md") as { source_path: string; target: string; alias: string | null }[];

    expect(links).toHaveLength(2);
    const targets = links.map((l) => l.target);
    expect(targets).toContain("Zigbee Devices");
    expect(targets).toContain("Home Dashboard");

    // Check aliased link
    const dashLink = links.find((l) => l.target === "Home Dashboard");
    expect(dashLink?.alias).toBe("Dashboard");
    db.close();
  });

  it("stores frontmatter as JSON", async () => {
    const db = new Database(INDEX_PATH, { readonly: true });
    const note = db
      .prepare("SELECT frontmatter_json FROM notes WHERE path = ?")
      .get("Projects/Battery Monitoring.md") as { frontmatter_json: string };

    const fm = JSON.parse(note.frontmatter_json);
    expect(fm.title).toBe("Battery Monitoring");
    expect(fm.tags).toEqual(["homeassistant", "automation"]);
    db.close();
  });

  it("sets schema version pragma", async () => {
    const db = new Database(INDEX_PATH, { readonly: true });
    const version = db.pragma("user_version", { simple: true });
    expect(Number(version)).toBe(1);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Reconciliation tests
// ---------------------------------------------------------------------------

describe("reconciliation", () => {
  const reconcileIndex = join(TEST_ROOT, "reconcile.db");

  it("removes stale notes on re-scan", async () => {
    const reconcileVault = join(TEST_ROOT, "reconcile-vault");
    mkdirSync(reconcileVault, { recursive: true });
    writeFileSync(join(reconcileVault, "note1.md"), "# Note 1\nContent.", "utf-8");
    writeFileSync(join(reconcileVault, "note2.md"), "# Note 2\nContent.", "utf-8");

    // First scan: both notes indexed
    const indexer1 = new VaultIndexer({ vaultRoot: reconcileVault, indexLocation: reconcileIndex });
    await indexer1.start();
    expect(indexer1.getNoteCount()).toBe(2);
    await indexer1.shutdown();

    // Delete one note while service is stopped
    unlinkSync(join(reconcileVault, "note2.md"));

    // Second scan: stale note should be removed
    const indexer2 = new VaultIndexer({ vaultRoot: reconcileVault, indexLocation: reconcileIndex });
    await indexer2.start();
    expect(indexer2.getNoteCount()).toBe(1);

    // Verify the correct note remains
    const db = new Database(reconcileIndex, { readonly: true });
    const paths = db.prepare("SELECT path FROM notes").all() as { path: string }[];
    expect(paths.map((p) => p.path)).toEqual(["note1.md"]);
    db.close();

    await indexer2.shutdown();
    rmSync(reconcileVault, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// File watcher tests
// ---------------------------------------------------------------------------

describe("file watcher", () => {
  const watchVault = join(TEST_ROOT, "watch-vault");
  const watchIndex = join(TEST_ROOT, "watch.db");
  let indexer: VaultIndexer;

  beforeAll(async () => {
    mkdirSync(watchVault, { recursive: true });
    writeFileSync(join(watchVault, "existing.md"), "# Existing\n\nOriginal content.", "utf-8");

    indexer = new VaultIndexer({ vaultRoot: watchVault, indexLocation: watchIndex });
    await indexer.start();
  });

  afterAll(async () => {
    await indexer?.shutdown();
    rmSync(watchVault, { recursive: true, force: true });
  });

  it("detects new files", async () => {
    writeFileSync(join(watchVault, "new-note.md"), "# New Note\n\nFresh content. #fresh", "utf-8");

    // Wait for chokidar to detect the change (awaitWriteFinish stabilityThreshold = 300ms)
    await new Promise((r) => setTimeout(r, 1500));

    const db = new Database(watchIndex, { readonly: true });
    const note = db
      .prepare("SELECT title FROM notes WHERE path = ?")
      .get("new-note.md") as { title: string } | undefined;
    db.close();

    expect(note).toBeDefined();
    expect(note!.title).toBe("New Note");
  });

  it("detects file modifications", async () => {
    writeFileSync(join(watchVault, "existing.md"), "# Existing\n\nUpdated content. #updated", "utf-8");

    await new Promise((r) => setTimeout(r, 1000));

    const db = new Database(watchIndex, { readonly: true });
    const note = db
      .prepare("SELECT content FROM notes WHERE path = ?")
      .get("existing.md") as { content: string } | undefined;
    const tags = db
      .prepare("SELECT tag FROM tags WHERE note_path = ?")
      .all("existing.md") as { tag: string }[];
    db.close();

    expect(note!.content).toContain("Updated content");
    expect(tags.map((t) => t.tag)).toContain("updated");
  });

  it("detects file deletions", async () => {
    writeFileSync(join(watchVault, "to-delete.md"), "# Delete Me\n\nTemporary.", "utf-8");
    await new Promise((r) => setTimeout(r, 1000));

    // Verify it was indexed
    let db = new Database(watchIndex, { readonly: true });
    let note = db.prepare("SELECT path FROM notes WHERE path = ?").get("to-delete.md");
    db.close();
    expect(note).toBeDefined();

    // Delete it
    unlinkSync(join(watchVault, "to-delete.md"));
    await new Promise((r) => setTimeout(r, 1000));

    // Verify it was removed
    db = new Database(watchIndex, { readonly: true });
    note = db.prepare("SELECT path FROM notes WHERE path = ?").get("to-delete.md");
    db.close();
    expect(note).toBeUndefined();
  });

  it("ignores non-markdown files", async () => {
    writeFileSync(join(watchVault, "image.png"), "fake png data", "utf-8");
    await new Promise((r) => setTimeout(r, 500));

    const db = new Database(watchIndex, { readonly: true });
    const note = db.prepare("SELECT path FROM notes WHERE path = ?").get("image.png");
    db.close();
    expect(note).toBeUndefined();
  });

  it("ignores dotfiles and dot-directories", async () => {
    mkdirSync(join(watchVault, ".obsidian"), { recursive: true });
    writeFileSync(join(watchVault, ".obsidian/workspace.json"), "{}", "utf-8");
    writeFileSync(join(watchVault, ".hidden-note.md"), "# Hidden", "utf-8");
    await new Promise((r) => setTimeout(r, 500));

    const db = new Database(watchIndex, { readonly: true });
    const results = db
      .prepare("SELECT path FROM notes WHERE path LIKE '.%'")
      .all();
    db.close();
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Shutdown tests
// ---------------------------------------------------------------------------

describe("shutdown", () => {
  it("performs clean shutdown with WAL checkpoint", async () => {
    const shutdownVault = join(TEST_ROOT, "shutdown-vault");
    const shutdownIndex = join(TEST_ROOT, "shutdown.db");
    mkdirSync(shutdownVault, { recursive: true });
    writeFileSync(join(shutdownVault, "note.md"), "# Note\n\nContent.", "utf-8");

    const indexer = new VaultIndexer({ vaultRoot: shutdownVault, indexLocation: shutdownIndex });
    await indexer.start();

    // Shutdown should not throw
    await indexer.shutdown();

    // DB should be readable after shutdown (WAL checkpointed)
    const db = new Database(shutdownIndex, { readonly: true });
    const count = db.prepare("SELECT COUNT(*) as c FROM notes").get() as { c: number };
    expect(count.c).toBe(1);
    db.close();

    rmSync(shutdownVault, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Error handling tests
// ---------------------------------------------------------------------------

describe("error handling", () => {
  it("throws on missing vault root", () => {
    expect(
      () => new VaultIndexer({ vaultRoot: "/nonexistent/vault", indexLocation: "/tmp/test.db" })
    ).toThrow(/does not exist/);
  });

  it("throws on index inside vault", () => {
    expect(
      () => new VaultIndexer({ vaultRoot: VAULT_ROOT, indexLocation: join(VAULT_ROOT, "index.db") })
    ).toThrow(/must not be inside vault root/);
  });
});
