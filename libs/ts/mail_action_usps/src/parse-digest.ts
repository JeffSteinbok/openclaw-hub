/**
 * Parse USPS Informed Delivery digest HTML to extract structured mailpiece data.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";

export interface DigestResult {
  mail_count: number;
  package_count: number;
  from_labels: string[];
  image_cids: string[];
  tracking_numbers: string[];
  has_no_image: boolean;
}

export interface ParsedDigest extends DigestResult {
  date: string;
  images: string[];
  scan_images: string[];
  ad_images: string[];
}

/**
 * HTML parser that extracts mailpiece info from USPS digest HTML body.
 * Ports the Python MailpieceExtractor (html.parser.HTMLParser subclass).
 */
export class MailpieceExtractor {
  mailpieces: Record<string, unknown>[] = [];
  packages: Record<string, unknown>[] = [];
  private _currentFrom = "";
  private _mailCount: number | null = null;
  private _pkgCount: number | null = null;

  parse(html: string): void {
    // Walk through text content between tags
    let pos = 0;
    while (pos < html.length) {
      const tagStart = html.indexOf("<", pos);
      if (tagStart === -1) {
        this._handleData(html.slice(pos));
        break;
      }
      if (tagStart > pos) {
        this._handleData(html.slice(pos, tagStart));
      }
      const tagEnd = html.indexOf(">", tagStart);
      if (tagEnd === -1) break;
      pos = tagEnd + 1;
    }
  }

  private _handleData(data: string): void {
    const text = data.trim();
    if (!text) return;

    const mailMatch = text.match(/You have (\d+) mailpiece/);
    if (mailMatch) {
      this._mailCount = parseInt(mailMatch[1], 10);
    }

    const pkgMatch = text.match(/You have (\d+) package/);
    if (pkgMatch) {
      this._pkgCount = parseInt(pkgMatch[1], 10);
    }

    if (text.startsWith("FROM:")) {
      this._currentFrom = text.slice(5).trim();
    }
  }

  get mailCount(): number | null {
    return this._mailCount;
  }

  get pkgCount(): number | null {
    return this._pkgCount;
  }
}

/**
 * Parse a USPS digest HTML file and extract mail/package counts,
 * FROM labels, image CID references, and tracking numbers.
 */
export function parseDigestHtml(htmlPath: string): DigestResult {
  const html = readFileSync(htmlPath, { encoding: "utf-8" });

  const result: DigestResult = {
    mail_count: 0,
    package_count: 0,
    from_labels: [],
    image_cids: [],
    tracking_numbers: [],
    has_no_image: false,
  };

  // Extract mail count
  const mailMatch = html.match(/You have (\d+) mailpiece/);
  if (mailMatch) {
    result.mail_count = parseInt(mailMatch[1], 10);
  }

  // Extract package count
  const pkgMatch = html.match(/You have (\d+) package/);
  if (pkgMatch) {
    result.package_count = parseInt(pkgMatch[1], 10);
  }

  // Extract FROM labels
  const fromMatches = html.matchAll(/(?:FROM|From):\s*([^<\n]+)/g);
  for (const m of fromMatches) {
    const label = m[1].trim();
    if (label) {
      result.from_labels.push(label);
    }
  }

  // Extract CID image references (inline mailpiece scans)
  const cidMatches = html.matchAll(/src="cid:([^"]+)"/g);
  for (const m of cidMatches) {
    result.image_cids.push(m[1]);
  }

  // Extract tracking numbers (USPS format: 20-34 digits)
  const trackingMatches = html.matchAll(/\b((?:94|92|93|94)\d{18,30})\b/g);
  const trackingSet = new Set<string>();
  for (const m of trackingMatches) {
    trackingSet.add(m[1]);
  }
  result.tracking_numbers = [...trackingSet];

  // Check for "no image" placeholder text
  if (
    html.includes("A scanned image of this mail piece") &&
    html.includes("not available")
  ) {
    result.has_no_image = true;
  }

  return result;
}

/**
 * Parse all digest folders and return structured data keyed by date.
 */
export function parseAllDigests(
  baseDir: string,
): Record<string, ParsedDigest> {
  const allData: Record<string, ParsedDigest> = {};

  let entries: string[];
  try {
    entries = readdirSync(baseDir).sort();
  } catch {
    return allData;
  }

  for (const name of entries) {
    if (!name.startsWith("20")) continue;
    const dateDirPath = join(baseDir, name);

    try {
      if (!statSync(dateDirPath).isDirectory()) continue;
    } catch {
      continue;
    }

    const bodyPath = join(dateDirPath, "body.html");
    try {
      statSync(bodyPath);
    } catch {
      continue;
    }

    const parsed = parseDigestHtml(bodyPath);

    // List actual image files
    const dirFiles = readdirSync(dateDirPath).sort();
    const images = dirFiles.filter(
      (f: string) => extname(f) === ".jpg" && !f.startsWith("content-"),
    );
    const scanImages = images.filter((i: string) => /^\d{10}-\d{3}\.jpg$/.test(i));
    const adImages = images.filter((i: string) => i.startsWith("mailer-"));

    allData[name] = {
      ...parsed,
      date: name,
      images,
      scan_images: scanImages,
      ad_images: adImages,
    };
  }

  return allData;
}
