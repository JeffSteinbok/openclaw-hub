/**
 * Vision analysis backends for USPS mailpiece scans.
 *
 * Two backends:
 *   - openclaw_agent: copies image to agent workspace, asks openclaw agent to analyze
 *   - provided: analysis is passed directly (for Copilot inline / testing)
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";

// Load the analysis prompt from the sibling markdown file
const PROMPT_PATH = join(dirname(new URL(import.meta.url).pathname), "analyze_prompt.md");
let ANALYSIS_PROMPT = "";
try {
  if (existsSync(PROMPT_PATH)) {
    ANALYSIS_PROMPT = readFileSync(PROMPT_PATH, "utf-8");
  }
} catch {
  // Prompt file not found — not critical
}

function buildAgentPrompt(stagingName: string): string {
  return (
    `View the image at camera_captures/${stagingName} and analyze it.\n\n` +
    `${ANALYSIS_PROMPT}\n\n` +
    "Return ONLY the JSON object, no markdown fences, no explanation."
  );
}

function getAgentMediaDir(agent: string): string {
  if (!agent) {
    throw new Error("vision_agent is required");
  }
  return join(
    homedir(),
    ".openclaw",
    "agents",
    agent,
    "workspace",
    "camera_captures",
  );
}

export interface AnalysisResult {
  sender: string;
  addressee: string;
  description: string;
  type: string;
  importance: string;
  mail_class: string;
  address_method: string;
}

/**
 * Analyze a single mailpiece scan via openclaw agent vision.
 */
export function analyzeViaAgent(
  imagePath: string,
  visionAgent: string,
): AnalysisResult {
  const agentMediaDir = getAgentMediaDir(visionAgent);
  mkdirSync(agentMediaDir, { recursive: true });

  const srcName = basename(imagePath);
  const stagingName = `usps-scan-${srcName}`;
  const stagingPath = join(agentMediaDir, stagingName);

  try {
    copyFileSync(imagePath, stagingPath);
    const prompt = buildAgentPrompt(stagingName);

    const stdout = execFileSync(
      "openclaw",
      [
        "agent",
        "--agent",
        visionAgent,
        "--json",
        "--timeout",
        "90",
        "--message",
        prompt,
      ],
      { timeout: 120000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );

    const data = JSON.parse(stdout);
    let text: string = data.result.payloads[0].text;

    // Strip markdown fences if present
    text = text.trim().replace(/^```(?:json)?\s*/, "");
    text = text.trim().replace(/\s*```$/, "");
    return JSON.parse(text);
  } finally {
    try {
      if (existsSync(stagingPath)) unlinkSync(stagingPath);
    } catch {
      // cleanup best-effort
    }
  }
}

/**
 * Ensure an analysis dict has all required fields with defaults.
 */
export function validateAnalysis(
  analysis: Record<string, unknown>,
): AnalysisResult {
  return {
    sender: (analysis.sender as string) ?? "Unknown",
    addressee: (analysis.addressee as string) ?? "Unknown",
    description: (analysis.description as string) ?? "",
    type: (analysis.type as string) ?? "scan",
    importance: (analysis.importance as string) ?? "medium",
    mail_class: (analysis.mail_class as string) ?? "Unknown",
    address_method: (analysis.address_method as string) ?? "",
  };
}
