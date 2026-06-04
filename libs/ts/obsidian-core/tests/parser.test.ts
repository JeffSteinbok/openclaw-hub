/**
 * Tests for @openclaw/obsidian-core — parser module.
 */

import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  extractTags,
  extractWikilinks,
  deriveTitle,
  parseNote,
} from "../src/parser.js";

// ---------------------------------------------------------------------------
// parseFrontmatter
// ---------------------------------------------------------------------------

describe("parseFrontmatter", () => {
  it("extracts YAML frontmatter", () => {
    const result = parseFrontmatter(`---
title: Test
tags: [a, b]
---

Content here.`);
    expect(result.frontmatter.title).toBe("Test");
    expect(result.frontmatter.tags).toEqual(["a", "b"]);
    expect(result.content.trim()).toBe("Content here.");
  });

  it("handles missing frontmatter", () => {
    const result = parseFrontmatter("# Just a heading\n\nSome content.");
    expect(result.frontmatter).toEqual({});
    expect(result.content).toContain("Just a heading");
  });

  it("handles empty frontmatter", () => {
    const result = parseFrontmatter("---\n---\n\nBody text.");
    expect(result.frontmatter).toEqual({});
    expect(result.content.trim()).toBe("Body text.");
  });

  it("handles malformed YAML gracefully", () => {
    const result = parseFrontmatter("---\n: broken: yaml: [[\n---\n\nBody.");
    // Should not throw, returns raw content
    expect(result.content).toBeTruthy();
  });

  it("preserves complex frontmatter values", () => {
    const result = parseFrontmatter(`---
title: My Note
created: 2024-01-15
nested:
  key: value
---

Content.`);
    expect(result.frontmatter.title).toBe("My Note");
    expect(result.frontmatter.created).toBeTruthy();
    expect((result.frontmatter.nested as Record<string, string>).key).toBe("value");
  });
});

// ---------------------------------------------------------------------------
// extractTags
// ---------------------------------------------------------------------------

describe("extractTags", () => {
  it("extracts inline tags", () => {
    const tags = extractTags("Some text #alpha and #beta-test here", {});
    expect(tags).toContain("alpha");
    expect(tags).toContain("beta-test");
  });

  it("extracts frontmatter array tags", () => {
    const tags = extractTags("No inline tags", { tags: ["FooBar", "baz"] });
    expect(tags).toContain("foobar");
    expect(tags).toContain("baz");
  });

  it("extracts comma-separated string tags", () => {
    const tags = extractTags("", { tag: "cooking, food" });
    expect(tags).toContain("cooking");
    expect(tags).toContain("food");
  });

  it("ignores tags inside fenced code blocks", () => {
    const content = "Real #tag here\n```\n#fake\n```\nAfter code.";
    const tags = extractTags(content, {});
    expect(tags).toContain("tag");
    expect(tags).not.toContain("fake");
  });

  it("ignores tags inside inline code", () => {
    const content = "Real #tag and `#inline_fake` done";
    const tags = extractTags(content, {});
    expect(tags).toContain("tag");
    expect(tags).not.toContain("inline_fake");
  });

  it("normalizes tags to lowercase", () => {
    const tags = extractTags("#CamelCase", {});
    expect(tags).toContain("camelcase");
  });

  it("deduplicates tags from frontmatter and inline", () => {
    const tags = extractTags("Text #iot here", { tags: ["IoT"] });
    const iotCount = tags.filter((t) => t === "iot").length;
    expect(iotCount).toBe(1);
  });

  it("handles tags with slashes (nested tags)", () => {
    const tags = extractTags("Text #project/homelab here", {});
    expect(tags).toContain("project/homelab");
  });

  it("returns sorted tags", () => {
    const tags = extractTags("#zebra #alpha #middle", {});
    expect(tags).toEqual(["alpha", "middle", "zebra"]);
  });

  it("returns empty array for tagless content", () => {
    const tags = extractTags("No tags at all.", {});
    expect(tags).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractWikilinks
// ---------------------------------------------------------------------------

describe("extractWikilinks", () => {
  it("extracts simple wikilinks", () => {
    const links = extractWikilinks("See [[Note A]] and [[Note B]].");
    expect(links).toHaveLength(2);
    expect(links[0]).toEqual({ target: "Note A", alias: null });
    expect(links[1]).toEqual({ target: "Note B", alias: null });
  });

  it("extracts aliased wikilinks", () => {
    const links = extractWikilinks("Link [[Note B|my alias]].");
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({ target: "Note B", alias: "my alias" });
  });

  it("extracts wikilinks with headings", () => {
    const links = extractWikilinks("See [[Note C#heading]].");
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({ target: "Note C", alias: null });
  });

  it("extracts wikilinks with heading + alias", () => {
    const links = extractWikilinks("[[Note D#section|label]].");
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({ target: "Note D", alias: "label" });
  });

  it("deduplicates wikilinks", () => {
    const links = extractWikilinks("[[Dup]] and [[Dup]] again.");
    expect(links).toHaveLength(1);
  });

  it("ignores wikilinks inside code blocks", () => {
    const content = "Real [[Note]] here\n```\n[[Fake]]\n```\nDone.";
    const links = extractWikilinks(content);
    expect(links).toHaveLength(1);
    expect(links[0].target).toBe("Note");
  });

  it("handles empty content", () => {
    const links = extractWikilinks("");
    expect(links).toHaveLength(0);
  });

  it("handles multiple links in one line", () => {
    const links = extractWikilinks("See [[A]], [[B]], and [[C]].");
    expect(links).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// deriveTitle
// ---------------------------------------------------------------------------

describe("deriveTitle", () => {
  it("uses frontmatter title first", () => {
    expect(deriveTitle({ title: "My Title" }, "# Other", "file.md")).toBe("My Title");
  });

  it("falls back to H1 heading", () => {
    expect(deriveTitle({}, "# Heading Title\n\nContent", "file.md")).toBe("Heading Title");
  });

  it("falls back to filename without extension", () => {
    expect(deriveTitle({}, "No heading", "path/to/My Note.md")).toBe("My Note");
  });

  it("trims whitespace from frontmatter title", () => {
    expect(deriveTitle({ title: "  Spaced  " }, "", "f.md")).toBe("Spaced");
  });

  it("ignores empty frontmatter title", () => {
    expect(deriveTitle({ title: "  " }, "# Actual", "f.md")).toBe("Actual");
  });

  it("handles Windows-style path separators", () => {
    expect(deriveTitle({}, "text", "path\\to\\Note.md")).toBe("Note");
  });
});

// ---------------------------------------------------------------------------
// parseNote
// ---------------------------------------------------------------------------

describe("parseNote", () => {
  it("parses a complete note", () => {
    const raw = `---
title: Battery Monitoring
tags: [homeassistant, automation]
---

# Battery Monitoring

Monitor battery levels. See also [[Zigbee Devices]].

#monitoring #iot
`;
    const note = parseNote(raw, "Projects/Battery Monitoring.md");
    expect(note.title).toBe("Battery Monitoring");
    expect(note.tags).toContain("homeassistant");
    expect(note.tags).toContain("automation");
    expect(note.tags).toContain("monitoring");
    expect(note.tags).toContain("iot");
    expect(note.wikilinks).toHaveLength(1);
    expect(note.wikilinks[0].target).toBe("Zigbee Devices");
    expect(note.content).toContain("Monitor battery levels");
  });

  it("parses a note with no frontmatter", () => {
    const raw = "# Quick Note\n\nJust a quick thought. #idea\n";
    const note = parseNote(raw, "Quick Note.md");
    expect(note.title).toBe("Quick Note");
    expect(note.tags).toContain("idea");
    expect(note.frontmatter).toEqual({});
  });

  it("parses a minimal note", () => {
    const raw = "Just plain text, no structure.";
    const note = parseNote(raw, "random.md");
    expect(note.title).toBe("random");
    expect(note.tags).toHaveLength(0);
    expect(note.wikilinks).toHaveLength(0);
  });
});
