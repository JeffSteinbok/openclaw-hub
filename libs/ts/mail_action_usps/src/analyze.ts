/**
 * Main USPS mail analysis pipeline.
 *
 * Flow: folder → parse HTML → vision-analyze images → apply rules → optional memory → notify
 */

import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
} from "node:fs";
import { extname, join } from "node:path";

import { parseDigestHtml, SCAN_IMAGE_RE } from "./parse-digest.js";
import { analyzeViaAgent, validateAnalysis } from "./vision.js";
import { applyRules, loadRules } from "./rules.js";
import {
  makeGuid,
  saveToAnalysis,
  writeMemoryForDate,
  updateState,
} from "./memory.js";
import {
  buildNotificationPlan,
  routeAndNotify,
  type NotificationEntry,
} from "./notify.js";

function detectDateFromHtml(htmlPath: string): string {
  try {
    const html = readFileSync(htmlPath, "utf-8");
    const dayPattern =
      /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*(\w+ \d{1,2},?\s*\d{4})/;
    const m = html.match(dayPattern);
    if (m) {
      const cleaned = m[1].replace(",", "");
      const dt = new Date(cleaned);
      if (!isNaN(dt.getTime())) {
        const y = dt.getFullYear();
        const mo = String(dt.getMonth() + 1).padStart(2, "0");
        const d = String(dt.getDate()).padStart(2, "0");
        return `${y}-${mo}-${d}`;
      }
    }
    const isoMatch = html.match(/(20\d{2}-\d{2}-\d{2})/);
    if (isoMatch) return isoMatch[1];
  } catch {
    // fall through
  }
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

const IMAGE_EXTS = [".jpg", ".jpeg", ".png"];

/** True when the file starts with JPEG or PNG magic bytes. */
function hasImageMagic(path: string): boolean {
  try {
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(8);
      const n = readSync(fd, buf, 0, 8, 0);
      if (n >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
        return true;
      }
      return (
        n >= 8 &&
        buf.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      );
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

/** True when a downloaded filename corresponds to one of the digest's cid: refs. */
function matchesCid(fname: string, cids: Set<string>): boolean {
  const stem = fname.slice(0, fname.length - extname(fname).length);
  for (const cid of cids) {
    if (fname === cid || stem === cid || cid.split("@")[0] === fname) {
      return true;
    }
  }
  return false;
}

/**
 * Pick the mailpiece scans out of the downloaded digest files.
 *
 * Accepts USPS scan filenames (`1025359682-062.jpg`) and images named after a
 * parsed cid. Inline parts saved without a name (`<cid>.bin`) are accepted only
 * when they match a cid and their magic bytes show a JPEG/PNG. Everything else
 * (ads, logos, `mailer-*`) is ignored.
 */
export function listScanImages(folder: string, cids: string[] = []): string[] {
  const images: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(folder).sort();
  } catch {
    return images;
  }
  const cidSet = new Set(cids);
  for (const f of entries) {
    const ext = extname(f).toLowerCase();
    if (IMAGE_EXTS.includes(ext)) {
      if (SCAN_IMAGE_RE.test(f) || matchesCid(f, cidSet)) images.push(f);
    } else if (ext === ".bin") {
      if (matchesCid(f, cidSet) && hasImageMagic(join(folder, f))) {
        images.push(f);
      }
    }
  }
  return images;
}

export interface ProcessDigestOptions {
  folder: string;
  analysis?: Array<Record<string, unknown>>;
  date?: string;
  dryRun?: boolean;
  visionBackend?: string;
  messageId?: string;
  persistAnalysis?: boolean;
  writeMemory?: boolean;
  sendNotifications?: boolean;
  updateWorkflowState?: boolean;
  workspaceAgent?: string;
  memoryAgent?: string;
  visionAgent?: string;
  /** Fallback notification channel when routing config has no default. */
  defaultChannel?: string;
  /** Fallback notification target when routing config has no default. */
  defaultTarget?: string;
}

/**
 * Process a single USPS digest.
 */
export async function processDigest(
  options: ProcessDigestOptions,
): Promise<Record<string, unknown>> {
  const {
    folder,
    analysis = undefined,
    date = undefined,
    dryRun = false,
    visionBackend = "auto",
    messageId = undefined,
    persistAnalysis = true,
    writeMemory = true,
    sendNotifications = true,
    updateWorkflowState = true,
    workspaceAgent,
    memoryAgent,
    visionAgent,
    defaultChannel,
    defaultTarget,
  } = options;

  if (!workspaceAgent) {
    throw new Error("workspace_agent is required");
  }
  if (writeMemory && !memoryAgent) {
    throw new Error("memory_agent is required when write_memory is enabled");
  }
  if (analysis === undefined && visionBackend === "auto" && !visionAgent) {
    throw new Error("vision_agent is required when vision_backend is auto");
  }

  const bodyHtml = join(folder, "body.html");
  if (!existsSync(bodyHtml)) {
    return { error: `No body.html found in ${folder}` };
  }

  // Parse the digest HTML
  const parsed = parseDigestHtml(bodyHtml);
  const dateStr = date ?? detectDateFromHtml(bodyHtml);

  // Find scan images
  const scanImages = listScanImages(folder, parsed.image_cids);

  // Build analysis for each image
  const items: Record<string, Record<string, unknown>> = {};
  const [rules, rulesVersion] = loadRules({ workspaceAgent });

  if (analysis !== undefined) {
    // Provided mode
    for (let i = 0; i < scanImages.length; i++) {
      const img = scanImages[i];
      const info: Record<string, unknown> =
        i < analysis.length
          ? { ...validateAnalysis(analysis[i]) }
          : { ...validateAnalysis({}) };
      info.guid = makeGuid(dateStr, img);
      info.rules_version = rulesVersion;
      info.vision_backend = "provided";
      const applied = applyRules(info, rules);
      items[img] = applied;
    }
  } else if (visionBackend === "skip") {
    for (const img of scanImages) {
      items[img] = {
        sender: "Unknown",
        addressee: "Unknown",
        description: "Vision analysis skipped",
        type: "scan",
        importance: "unknown",
        mail_class: "Unknown",
        address_method: "",
        guid: makeGuid(dateStr, img),
        rules_version: rulesVersion,
        vision_backend: "skip",
      };
    }
  } else {
    // Auto mode
    for (const img of scanImages) {
      process.stderr.write(`  Analyzing ${img}...\n`);
      let info: Record<string, unknown>;
      try {
        const raw = analyzeViaAgent(join(folder, img), visionAgent!);
        info = { ...validateAnalysis(raw as unknown as Record<string, unknown>) };
      } catch (e) {
        // Record as a failure, not routine mail; rules are not applied to it.
        const err = String(e).slice(0, 200);
        process.stderr.write(`  Vision analysis failed for ${img}: ${err}\n`);
        info = {
          ...validateAnalysis({}),
          importance: "unknown",
          description: "Vision analysis failed",
          vision_error: err,
        };
      }
      info.guid = makeGuid(dateStr, img);
      info.rules_version = rulesVersion;
      info.vision_backend = "openclaw_agent";
      items[img] = info.vision_error ? info : applyRules(info, rules);
    }
  }

  const visionFailures = Object.entries(items)
    .filter(([, info]) => info.vision_error)
    .map(([fname, info]) => ({ image: fname, error: info.vision_error as string }));
  const analyzedCount = Object.keys(items).length - visionFailures.length;

  // The digest lists mail pieces but no scan was analyzed (images missing or every
  // vision call failed). Don't persist, write memory, or mark processed, so a
  // later re-run can still succeed. A digest whose pieces all say "image not
  // available" (no cid refs) is handled normally.
  const expectsScans =
    parsed.image_cids.length > 0 || (parsed.mail_count > 0 && !parsed.has_no_image);
  if (expectsScans && analyzedCount === 0) {
    const reason =
      scanImages.length === 0
        ? `no scan images found (mail_count=${parsed.mail_count}, ` +
          `cid refs=${parsed.image_cids.length})`
        : `vision analysis failed for all ${scanImages.length} scan image(s)`;
    process.stderr.write(`  WARNING: USPS digest ${dateStr} not analyzed: ${reason}\n`);
    return {
      date: dateStr,
      incomplete: true,
      reason,
      mail_count: parsed.mail_count ?? 0,
      image_cids: parsed.image_cids,
      scan_images: scanImages,
      images_analyzed: 0,
      vision_failures: visionFailures,
      notifications_sent: 0,
      memory_written: false,
    };
  }

  // Persist analysis
  if (persistAnalysis) {
    saveToAnalysis(dateStr, items, workspaceAgent);
  }

  // Write memory markdown
  const memoryItems = Object.entries(items).map(([fname, info]) => ({
    ...info,
    image: fname,
  }));
  let memoryPath: string | null = null;
  if (writeMemory) {
    memoryPath = writeMemoryForDate(dateStr, memoryItems, memoryAgent!);
  }

  const notificationPlan = buildNotificationPlan(
    dateStr,
    Object.values(items),
    { workspaceAgent, defaultChannel, defaultTarget },
  );
  let notifications: NotificationEntry[] = [];
  if (sendNotifications) {
    notifications = routeAndNotify(dateStr, Object.values(items), {
      dryRun,
      workspaceAgent,
      defaultChannel,
      defaultTarget,
    });
  }

  // Update workflow state
  if (updateWorkflowState && !dryRun) {
    updateState({
      messageId,
      dateProcessed: dateStr,
      workspaceAgent,
    });
  }

  // Summary
  const impCounts: Record<string, number> = {};
  for (const info of Object.values(items)) {
    const imp = (info.importance as string) ?? "unknown";
    impCounts[imp] = (impCounts[imp] ?? 0) + 1;
  }

  return {
    date: dateStr,
    mail_count: parsed.mail_count ?? 0,
    images_analyzed: analyzedCount,
    vision_failures: visionFailures,
    importance_breakdown: impCounts,
    structured_items: Object.entries(items).map(([fname, info]) => ({
      image: fname,
      ...info,
    })),
    items: Object.entries(items).map(([fname, info]) => ({
      image: fname,
      sender: (info.sender as string) ?? "Unknown",
      addressee: (info.addressee as string) ?? "Unknown",
      importance: (info.importance as string) ?? "unknown",
      description: (info.description as string) ?? "",
      guid: ((info.guid as string) ?? "").slice(0, 8),
    })),
    notification_plan: notificationPlan,
    notifications_sent: notifications.filter((n) => n.sent === true).length,
    notification_details: notifications,
    memory_file: memoryPath,
    analysis_saved: persistAnalysis,
    memory_written: !!memoryPath,
  };
}
