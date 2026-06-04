/**
 * Handlers — core tool logic.
 *
 * Pure functions that accept config/reader and return structured results.
 * No knowledge of the plugin framework.
 */

import { readFileSync, statSync } from "node:fs";
import { relative } from "node:path";
import { resolveSafePath, parseNote, type VaultConfig } from "@openclaw/obsidian-core";
import type { VaultReader } from "./reader.js";

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function checkReady(reader: VaultReader): { error: string } | null {
  const status = reader.getStatus();
  if (status.state === "ready") return null;
  return { error: status.message };
}

export function handleSearch(
  reader: VaultReader,
  query: string,
  limit: number,
): unknown {
  const err = checkReady(reader);
  if (err) return err;
  if (!query.trim()) {
    return { error: "Query must not be empty" };
  }
  try {
    const results = reader.search(query, limit);
    return { output: results };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `Search failed: ${msg}` };
  }
}

export function handleRead(
  config: VaultConfig,
  notePath: string,
): unknown {
  if (!notePath.trim()) {
    return { error: "Note path must not be empty" };
  }

  try {
    const safePath = resolveSafePath(config.vaultRoot, notePath);

    // Read directly from filesystem for freshest content
    const raw = readFileSync(safePath, "utf-8");
    const stat = statSync(safePath);
    const relPath = relative(config.vaultRoot, safePath);
    const parsed = parseNote(raw, relPath);

    return {
      output: {
        path: relPath,
        title: parsed.title,
        content: parsed.content,
        frontmatter: parsed.frontmatter,
        tags: parsed.tags,
        wikilinks: parsed.wikilinks,
        modified: new Date(stat.mtimeMs).toISOString(),
      },
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("escapes vault root") || msg.includes("Invalid path")) {
      return { error: `Access denied: ${msg}` };
    }
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { error: `Note not found: ${notePath}` };
    }
    return { error: msg };
  }
}

export function handleRecent(
  reader: VaultReader,
  limit: number,
): unknown {
  const err = checkReady(reader);
  if (err) return err;
  const results = reader.listRecent(limit);
  return {
    output: results.map((r) => ({
      path: r.path,
      title: r.title,
      modified: new Date(r.mtime_ms).toISOString(),
    })),
  };
}

export function handleTags(reader: VaultReader): unknown {
  const err = checkReady(reader);
  if (err) return err;
  return { output: reader.listTags() };
}

export function handleBacklinks(
  reader: VaultReader,
  notePath: string,
): unknown {
  const err = checkReady(reader);
  if (err) return err;
  if (!notePath.trim()) {
    return { error: "Note path must not be empty" };
  }
  return { output: reader.getBacklinks(notePath) };
}

export function handleRelated(
  reader: VaultReader,
  notePath: string,
): unknown {
  const err = checkReady(reader);
  if (err) return err;
  if (!notePath.trim()) {
    return { error: "Note path must not be empty" };
  }
  return { output: reader.getRelatedNotes(notePath) };
}
