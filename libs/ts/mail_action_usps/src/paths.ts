/**
 * Workspace path helpers for USPS analysis data.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export function getWorkspaceAgent(agent?: string | null): string {
  if (!agent) {
    throw new Error("workspace_agent must be specified explicitly");
  }
  return agent;
}

export function getWorkspaceRoot(agent?: string | null): string {
  return join(
    homedir(),
    ".openclaw",
    "agents",
    getWorkspaceAgent(agent),
    "workspace",
  );
}

export function getMemoryDir(agent?: string | null): string {
  return join(getWorkspaceRoot(agent), "memory");
}

export function getLongTermMemoryDir(agent?: string | null): string {
  return join(getWorkspaceRoot(agent), "memory", "mail");
}

export function getUspsDir(agent?: string | null): string {
  return join(getWorkspaceRoot(agent), "usps-mail");
}

export function getAnalysisFile(agent?: string | null): string {
  return join(getMemoryDir(agent), "usps_analysis.json");
}

export function getStateFile(agent?: string | null): string {
  return join(getMemoryDir(agent), "usps_state.json");
}

export function getRulesFile(agent?: string | null): string {
  return join(getUspsDir(agent), "rules.json");
}

export function getConfigFile(agent?: string | null): string {
  return join(getUspsDir(agent), "config.json");
}
