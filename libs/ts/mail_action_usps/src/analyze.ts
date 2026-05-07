/**
 * Main USPS mail analysis pipeline.
 *
 * Flow: folder → parse HTML → vision-analyze images → apply rules → optional memory → notify
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, basename } from "node:path";

import { parseDigestHtml } from "./parse-digest.js";
import { analyzeViaAgent, validateAnalysis } from "./vision.js";
import { applyRules, loadRules } from "./rules.js";
import {
  makeGuid,
  saveToAnalysis,
  writeMemoryForDate,
  updateState,
} from "./memory.js";
import { buildNotificationPlan, routeAndNotify } from "./notify.js";

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

function listScanImages(folder: string): string[] {
  const images: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(folder).sort();
  } catch {
    return images;
  }
  for (const f of entries) {
    const ext = extname(f).toLowerCase();
    if (![".jpg", ".jpeg", ".png"].includes(ext)) continue;
    if (f.startsWith("content-") || f === "body.html") continue;
    images.push(f);
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
  const scanImages = listScanImages(folder);

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
        info = { ...validateAnalysis({}) };
        info.description = `Vision analysis failed: ${String(e).slice(0, 100)}`;
      }
      info.guid = makeGuid(dateStr, img);
      info.rules_version = rulesVersion;
      info.vision_backend = "openclaw_agent";
      const applied = applyRules(info, rules);
      items[img] = applied;
    }
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
    { workspaceAgent },
  );
  let notifications: unknown[] = [];
  if (sendNotifications) {
    notifications = routeAndNotify(dateStr, Object.values(items), {
      dryRun,
      workspaceAgent,
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
    images_analyzed: Object.keys(items).length,
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
    notifications_sent: notifications.length,
    notification_details: notifications,
    memory_file: memoryPath,
    analysis_saved: persistAnalysis,
    memory_written: !!memoryPath,
  };
}
