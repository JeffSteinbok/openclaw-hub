/**
 * Tests for the HTML to PDF plugin.
 *
 * The chromium integration test is skipped automatically when no Chromium
 * binary is found on the system. Validation tests always run.
 */

import { describe, it, expect, afterEach } from "vitest";
import { writeFile, rm, stat, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { htmlToPdf } from "../src/index.js";

const execFileAsync = promisify(execFile);

const tmpHtml = join(tmpdir(), "html-to-pdf-test.html");
const tmpPdf = join(tmpdir(), "html-to-pdf-test.pdf");

async function chromiumAvailable(): Promise<boolean> {
  for (const bin of ["chromium-browser", "chromium", "google-chrome"]) {
    try {
      await execFileAsync("which", [bin]);
      return true;
    } catch {
      // continue
    }
  }
  return false;
}

afterEach(async () => {
  for (const f of [tmpHtml, tmpPdf]) {
    try {
      await rm(f);
    } catch {
      // ignore — file may not exist
    }
  }
});

// ---------------------------------------------------------------------------
// Input validation (no Chromium needed)
// ---------------------------------------------------------------------------

describe("html_to_pdf validation", () => {
  it("returns error when output_path does not end in .pdf", async () => {
    const result = await htmlToPdf("/tmp/test.html", "/tmp/output.html");
    expect(result.success).toBe(false);
    expect(result.error).toContain(".pdf");
  });

  it("returns error when input file does not exist", async () => {
    const result = await htmlToPdf("/nonexistent/path/file.html", "/tmp/output.pdf");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// Integration test (requires Chromium)
// ---------------------------------------------------------------------------

describe("html_to_pdf integration", () => {
  it("converts a simple HTML file to a non-empty PDF", async (ctx) => {
    if (!(await chromiumAvailable())) {
      ctx.skip();
      return;
    }

    await writeFile(tmpHtml, "<html><body><h1>Hello PDF</h1></body></html>");

    const result = await htmlToPdf(tmpHtml, tmpPdf, 30000);

    expect(result.success).toBe(true);
    expect(result.output_path).toBe(tmpPdf);

    await access(tmpPdf);
    const info = await stat(tmpPdf);
    expect(info.size).toBeGreaterThan(0);
  });
});
