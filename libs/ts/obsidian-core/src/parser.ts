/**
 * Parser — Markdown frontmatter, wikilink, and tag extraction.
 *
 * Handles Obsidian-flavored Markdown features without requiring Obsidian.
 */

import matter from "gray-matter";
import type { ParsedNote, WikiLink } from "./types.js";

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

export function parseFrontmatter(raw: string): { content: string; frontmatter: Record<string, unknown> } {
  try {
    const result = matter(raw);
    return {
      content: result.content,
      frontmatter: (result.data as Record<string, unknown>) ?? {},
    };
  } catch {
    // If frontmatter parsing fails, treat entire content as body
    return { content: raw, frontmatter: {} };
  }
}

// ---------------------------------------------------------------------------
// Tag extraction
// ---------------------------------------------------------------------------

const FENCED_CODE_BLOCK = /^```[\s\S]*?^```/gm;
const INLINE_CODE = /`[^`]+`/g;

/** Match inline tags: #word but not inside code */
const TAG_PATTERN = /(?:^|\s)#([a-zA-Z][\w-/]*)/g;

/**
 * Extract all tags from a note. Combines:
 * - YAML frontmatter `tags` / `tag` fields
 * - Inline `#tag` occurrences (outside code blocks)
 */
export function extractTags(content: string, frontmatter: Record<string, unknown>): string[] {
  const tags = new Set<string>();

  // Frontmatter tags
  for (const key of ["tags", "tag"]) {
    const val = frontmatter[key];
    if (Array.isArray(val)) {
      for (const t of val) {
        if (typeof t === "string" && t.trim()) {
          tags.add(normalizeTag(t.trim()));
        }
      }
    } else if (typeof val === "string" && val.trim()) {
      // Comma or space separated
      for (const t of val.split(/[,\s]+/)) {
        if (t.trim()) tags.add(normalizeTag(t.trim()));
      }
    }
  }

  // Inline tags — strip code blocks first
  const stripped = content.replace(FENCED_CODE_BLOCK, "").replace(INLINE_CODE, "");
  let match: RegExpExecArray | null;
  while ((match = TAG_PATTERN.exec(stripped)) !== null) {
    tags.add(normalizeTag(match[1]));
  }

  return [...tags].sort();
}

function normalizeTag(tag: string): string {
  return tag.startsWith("#") ? tag.slice(1).toLowerCase() : tag.toLowerCase();
}

// ---------------------------------------------------------------------------
// Wikilink extraction
// ---------------------------------------------------------------------------

const WIKILINK_PATTERN = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;

/**
 * Extract all wikilinks from Markdown content.
 * Handles: [[Note]], [[Note|alias]], [[Note#heading]], [[Note#heading|alias]]
 */
export function extractWikilinks(content: string): WikiLink[] {
  const links: WikiLink[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  // Strip code blocks
  const stripped = content.replace(FENCED_CODE_BLOCK, "").replace(INLINE_CODE, "");

  while ((match = WIKILINK_PATTERN.exec(stripped)) !== null) {
    const target = match[1].trim();
    const alias = match[2]?.trim() ?? null;
    const key = `${target}|${alias ?? ""}`;
    if (target && !seen.has(key)) {
      seen.add(key);
      links.push({ target, alias });
    }
  }

  return links;
}

// ---------------------------------------------------------------------------
// Full note parsing
// ---------------------------------------------------------------------------

/**
 * Derive a title from the note. Priority:
 * 1. Frontmatter `title` field
 * 2. First H1 (`# Title`)
 * 3. Filename without extension
 */
export function deriveTitle(
  frontmatter: Record<string, unknown>,
  content: string,
  filePath: string,
): string {
  if (typeof frontmatter.title === "string" && frontmatter.title.trim()) {
    return frontmatter.title.trim();
  }

  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) {
    return h1Match[1].trim();
  }

  // Filename without extension
  const parts = filePath.replace(/\\/g, "/").split("/");
  const filename = parts[parts.length - 1] ?? filePath;
  return filename.replace(/\.md$/i, "");
}

/**
 * Parse a raw Markdown file into structured note data.
 */
export function parseNote(raw: string, filePath: string): ParsedNote {
  const { content, frontmatter } = parseFrontmatter(raw);
  const title = deriveTitle(frontmatter, content, filePath);
  const tags = extractTags(content, frontmatter);
  const wikilinks = extractWikilinks(content);

  return { title, content, frontmatter, tags, wikilinks };
}
