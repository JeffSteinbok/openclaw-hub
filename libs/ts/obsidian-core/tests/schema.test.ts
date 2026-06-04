/**
 * Tests for @openclaw/obsidian-core — schema module.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { initSchema, validateSchemaVersion, SCHEMA_DDL } from "../src/schema.js";
import { SCHEMA_VERSION } from "../src/types.js";

const TEST_ROOT = join(tmpdir(), `obsidian-schema-test-${Date.now()}`);

beforeAll(() => {
  mkdirSync(TEST_ROOT, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("initSchema", () => {
  it("creates all expected tables", () => {
    const db = new Database(join(TEST_ROOT, "schema1.db"));
    db.pragma("journal_mode = WAL");
    initSchema(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);

    expect(names).toContain("notes");
    expect(names).toContain("tags");
    expect(names).toContain("links");
    // FTS virtual tables
    expect(names.some((n) => n.startsWith("notes_fts"))).toBe(true);

    db.close();
  });

  it("creates expected triggers", () => {
    const db = new Database(join(TEST_ROOT, "schema2.db"));
    db.pragma("journal_mode = WAL");
    initSchema(db);

    const triggers = db
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name")
      .all() as { name: string }[];
    const names = triggers.map((t) => t.name);

    expect(names).toContain("notes_ai");
    expect(names).toContain("notes_ad");
    expect(names).toContain("notes_au");

    db.close();
  });

  it("sets schema version pragma", () => {
    const db = new Database(join(TEST_ROOT, "schema3.db"));
    db.pragma("journal_mode = WAL");
    initSchema(db);

    const version = db.pragma("user_version", { simple: true });
    expect(Number(version)).toBe(SCHEMA_VERSION);

    db.close();
  });

  it("is idempotent (safe to call multiple times)", () => {
    const db = new Database(join(TEST_ROOT, "schema4.db"));
    db.pragma("journal_mode = WAL");
    initSchema(db);
    initSchema(db); // should not throw

    const count = db
      .prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='notes'")
      .get() as { c: number };
    expect(count.c).toBe(1);

    db.close();
  });

  it("supports FTS insert and query after schema init", () => {
    const db = new Database(join(TEST_ROOT, "schema5.db"));
    db.pragma("journal_mode = WAL");
    initSchema(db);

    db.prepare(
      "INSERT INTO notes (path, title, content, frontmatter_json, mtime_ms) VALUES (?, ?, ?, ?, ?)"
    ).run("test.md", "Test Note", "This is a test note about batteries.", "{}", Date.now());

    const results = db
      .prepare(
        "SELECT n.title FROM notes_fts JOIN notes n ON n.rowid = notes_fts.rowid WHERE notes_fts MATCH 'batteries'"
      )
      .all() as { title: string }[];

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Test Note");

    db.close();
  });
});

describe("validateSchemaVersion", () => {
  it("returns true for matching version", () => {
    const db = new Database(join(TEST_ROOT, "validate1.db"));
    db.pragma("journal_mode = WAL");
    initSchema(db);

    expect(validateSchemaVersion(db)).toBe(true);
    db.close();
  });

  it("returns false for mismatched version", () => {
    const db = new Database(join(TEST_ROOT, "validate2.db"));
    db.pragma(`user_version = ${SCHEMA_VERSION + 99}`);

    expect(validateSchemaVersion(db)).toBe(false);
    db.close();
  });

  it("returns false for uninitialized DB (version 0)", () => {
    const db = new Database(join(TEST_ROOT, "validate3.db"));
    expect(validateSchemaVersion(db)).toBe(false);
    db.close();
  });
});
