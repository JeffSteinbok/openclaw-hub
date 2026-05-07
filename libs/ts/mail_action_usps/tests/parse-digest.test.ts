import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  MailpieceExtractor,
  parseDigestHtml,
  parseAllDigests,
} from "../src/parse-digest.js";

const SAMPLE_HTML = `\
<html>
<body>
<p>You have 3 mailpieces arriving today.</p>
<p>You have 1 package arriving soon.</p>
<div>
  <p>FROM: ACME Corporation</p>
  <img src="cid:image001.jpg" />
</div>
<div>
  <p>From: Bank of America</p>
  <img src="cid:image002.jpg" />
</div>
<div>
  <p>FROM: US Treasury</p>
</div>
<p>Tracking: 9400111899223100001234</p>
</body>
</html>
`;

const NO_IMAGE_HTML = `\
<html>
<body>
<p>You have 1 mailpiece arriving today.</p>
<p>A scanned image of this mail piece is not available at this time.</p>
</body>
</html>
`;

const MINIMAL_HTML = "<html><body><p>Hello</p></body></html>";

function writeHtml(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "usps-test-"));
  const path = join(dir, "body.html");
  writeFileSync(path, content);
  return path;
}

describe("parseDigestHtml", () => {
  it("extracts mail count", () => {
    const path = writeHtml(SAMPLE_HTML);
    const result = parseDigestHtml(path);
    expect(result.mail_count).toBe(3);
  });

  it("extracts package count", () => {
    const path = writeHtml(SAMPLE_HTML);
    const result = parseDigestHtml(path);
    expect(result.package_count).toBe(1);
  });

  it("extracts FROM labels", () => {
    const path = writeHtml(SAMPLE_HTML);
    const result = parseDigestHtml(path);
    expect(result.from_labels).toContain("ACME Corporation");
    expect(result.from_labels).toContain("Bank of America");
    expect(result.from_labels).toContain("US Treasury");
  });

  it("extracts image CIDs", () => {
    const path = writeHtml(SAMPLE_HTML);
    const result = parseDigestHtml(path);
    expect(result.image_cids).toContain("image001.jpg");
    expect(result.image_cids).toContain("image002.jpg");
    expect(result.image_cids).toHaveLength(2);
  });

  it("extracts tracking numbers", () => {
    const path = writeHtml(SAMPLE_HTML);
    const result = parseDigestHtml(path);
    expect(result.tracking_numbers).toContain("9400111899223100001234");
  });

  it("detects no image flag", () => {
    const path = writeHtml(NO_IMAGE_HTML);
    const result = parseDigestHtml(path);
    expect(result.has_no_image).toBe(true);
  });

  it("no image flag is false for normal HTML", () => {
    const path = writeHtml(SAMPLE_HTML);
    const result = parseDigestHtml(path);
    expect(result.has_no_image).toBe(false);
  });

  it("handles minimal HTML", () => {
    const path = writeHtml(MINIMAL_HTML);
    const result = parseDigestHtml(path);
    expect(result.mail_count).toBe(0);
    expect(result.package_count).toBe(0);
    expect(result.from_labels).toEqual([]);
    expect(result.image_cids).toEqual([]);
    expect(result.tracking_numbers).toEqual([]);
    expect(result.has_no_image).toBe(false);
  });
});

describe("parseAllDigests", () => {
  it("parses multiple date dirs", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-test-"));
    for (const date of ["2024-01-15", "2024-01-16"]) {
      const d = join(td, date);
      mkdirSync(d, { recursive: true });
      writeFileSync(
        join(d, "body.html"),
        "<html><body><p>You have 2 mailpieces.</p></body></html>",
      );
    }
    const result = parseAllDigests(td);
    expect(result["2024-01-15"]).toBeDefined();
    expect(result["2024-01-16"]).toBeDefined();
    expect(result["2024-01-15"].mail_count).toBe(2);
  });

  it("skips non-date dirs", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-test-"));
    mkdirSync(join(td, "not-a-date"));
    writeFileSync(
      join(td, "not-a-date", "body.html"),
      "<html><body></body></html>",
    );
    mkdirSync(join(td, "2024-01-15"));
    writeFileSync(
      join(td, "2024-01-15", "body.html"),
      "<html><body><p>You have 1 mailpiece.</p></body></html>",
    );
    const result = parseAllDigests(td);
    expect(result["not-a-date"]).toBeUndefined();
    expect(result["2024-01-15"]).toBeDefined();
  });

  it("skips dirs without body.html", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-test-"));
    mkdirSync(join(td, "2024-01-15"));
    const result = parseAllDigests(td);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("lists images correctly", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-test-"));
    const d = join(td, "2024-01-15");
    mkdirSync(d);
    writeFileSync(join(d, "body.html"), "<html><body></body></html>");
    writeFileSync(join(d, "1234567890-001.jpg"), "");
    writeFileSync(join(d, "mailer-ad1.jpg"), "");
    writeFileSync(join(d, "content-header.jpg"), "");

    const result = parseAllDigests(td);
    const info = result["2024-01-15"];
    expect(info.scan_images).toContain("1234567890-001.jpg");
    expect(info.ad_images).toContain("mailer-ad1.jpg");
    expect(info.images).not.toContain("content-header.jpg");
  });

  it("handles empty dir", () => {
    const td = mkdtempSync(join(tmpdir(), "usps-test-"));
    const result = parseAllDigests(td);
    expect(result).toEqual({});
  });
});
