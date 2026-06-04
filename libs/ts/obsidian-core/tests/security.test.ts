/**
 * Tests for @openclaw/obsidian-core — security module.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveSafePath,
  canonicalizeVaultRoot,
  validateIndexLocation,
} from "../src/security.js";

const TEST_ROOT = join(tmpdir(), `obsidian-security-test-${Date.now()}`);
const VAULT_ROOT = join(TEST_ROOT, "vault");

beforeAll(() => {
  mkdirSync(join(VAULT_ROOT, "Projects"), { recursive: true });
  writeFileSync(join(VAULT_ROOT, "test.md"), "test content", "utf-8");
  writeFileSync(join(VAULT_ROOT, "Projects/note.md"), "project note", "utf-8");
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// resolveSafePath
// ---------------------------------------------------------------------------

describe("resolveSafePath", () => {
  it("resolves a valid path inside vault", () => {
    const result = resolveSafePath(VAULT_ROOT, "test.md");
    expect(result).toBe(join(VAULT_ROOT, "test.md"));
  });

  it("resolves nested paths", () => {
    const result = resolveSafePath(VAULT_ROOT, "Projects/note.md");
    expect(result).toBe(join(VAULT_ROOT, "Projects/note.md"));
  });

  it("rejects path traversal with ../", () => {
    expect(() => resolveSafePath(VAULT_ROOT, "../../etc/passwd")).toThrow(/escapes vault root/);
  });

  it("rejects absolute paths", () => {
    expect(() => resolveSafePath(VAULT_ROOT, "/etc/passwd")).toThrow(/absolute paths/);
  });

  it("rejects null bytes", () => {
    expect(() => resolveSafePath(VAULT_ROOT, "file\0.md")).toThrow(/null bytes/);
  });

  it("rejects empty path", () => {
    expect(() => resolveSafePath(VAULT_ROOT, "")).toThrow(/empty/);
  });

  it("allows nonexistent file paths inside vault", () => {
    const result = resolveSafePath(VAULT_ROOT, "new-note.md");
    expect(result).toBe(join(VAULT_ROOT, "new-note.md"));
  });

  it("rejects symlink escaping vault", () => {
    const linkPath = join(VAULT_ROOT, "escape-link.md");
    try {
      symlinkSync("/etc/hostname", linkPath);
      expect(() => resolveSafePath(VAULT_ROOT, "escape-link.md")).toThrow(/escapes vault root/);
    } finally {
      try { rmSync(linkPath); } catch { /* ignore */ }
    }
  });

  it("handles paths with spaces", () => {
    const dir = join(VAULT_ROOT, "My Notes");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "note with spaces.md"), "content", "utf-8");
    const result = resolveSafePath(VAULT_ROOT, "My Notes/note with spaces.md");
    expect(result).toBe(join(VAULT_ROOT, "My Notes/note with spaces.md"));
  });
});

// ---------------------------------------------------------------------------
// canonicalizeVaultRoot
// ---------------------------------------------------------------------------

describe("canonicalizeVaultRoot", () => {
  it("returns canonical path for existing directory", () => {
    const result = canonicalizeVaultRoot(VAULT_ROOT);
    expect(result).toBe(VAULT_ROOT);
  });

  it("throws for nonexistent directory", () => {
    expect(() => canonicalizeVaultRoot("/nonexistent/vault")).toThrow(/does not exist/);
  });

  it("throws for file path (not directory)", () => {
    const filePath = join(VAULT_ROOT, "test.md");
    expect(() => canonicalizeVaultRoot(filePath)).toThrow(/not a directory/);
  });
});

// ---------------------------------------------------------------------------
// validateIndexLocation
// ---------------------------------------------------------------------------

describe("validateIndexLocation", () => {
  it("allows index outside vault", () => {
    expect(() => validateIndexLocation(VAULT_ROOT, join(TEST_ROOT, "index.db"))).not.toThrow();
  });

  it("rejects index inside vault", () => {
    expect(() => validateIndexLocation(VAULT_ROOT, join(VAULT_ROOT, "index.db")))
      .toThrow(/must not be inside vault root/);
  });

  it("rejects index at vault root", () => {
    expect(() => validateIndexLocation(VAULT_ROOT, VAULT_ROOT))
      .toThrow(/must not be inside vault root/);
  });
});
