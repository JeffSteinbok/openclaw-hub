/**
 * Handlers — core tool logic.
 *
 * Pure functions that accept config/index and return structured results.
 * No knowledge of the plugin framework.
 */

import { readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { resolveSafePath } from "./security.js";
import { parseNote } from "./parser.js";
import type { VaultIndex } from "./indexer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VaultConfig {
  vaultRoot: string;
  indexLocation: string;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export function handleSearch(
  index: VaultIndex,
  query: string,
  limit: number,
): unknown {
  if (!index.ready) {
    return { error: "Index is still being built. Please try again in a moment." };
  }
  if (!query.trim()) {
    return { error: "Query must not be empty" };
  }
  try {
    const results = index.search(query, limit);
    return { output: results };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `Search failed: ${msg}` };
  }
}

export function handleRead(
  config: VaultConfig,
  index: VaultIndex,
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
  index: VaultIndex,
  limit: number,
): unknown {
  if (!index.ready) {
    return { error: "Index is still being built. Please try again in a moment." };
  }
  const results = index.listRecent(limit);
  return {
    output: results.map((r) => ({
      path: r.path,
      title: r.title,
      modified: new Date(r.mtime_ms).toISOString(),
    })),
  };
}

export function handleTags(index: VaultIndex): unknown {
  if (!index.ready) {
    return { error: "Index is still being built. Please try again in a moment." };
  }
  return { output: index.listTags() };
}

export function handleBacklinks(
  index: VaultIndex,
  notePath: string,
): unknown {
  if (!index.ready) {
    return { error: "Index is still being built. Please try again in a moment." };
  }
  if (!notePath.trim()) {
    return { error: "Note path must not be empty" };
  }
  return { output: index.getBacklinks(notePath) };
}

export function handleRelated(
  index: VaultIndex,
  notePath: string,
): unknown {
  if (!index.ready) {
    return { error: "Index is still being built. Please try again in a moment." };
  }
  if (!notePath.trim()) {
    return { error: "Note path must not be empty" };
  }
  return { output: index.getRelatedNotes(notePath) };
}
