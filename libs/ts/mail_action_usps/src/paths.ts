/**
 * Workspace path helpers for USPS analysis data.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import JSON5 from "json5";

type WorkspaceEntry = { workspace?: string };
export type OpenClawWorkspaceConfig = {
  agents?: {
    entries?: Record<string, WorkspaceEntry>;
    list?: Array<WorkspaceEntry & { id: string }>;
  };
};

const workspaceConfig = new AsyncLocalStorage<OpenClawWorkspaceConfig>();

export function withWorkspaceConfig<T>(config: OpenClawWorkspaceConfig | undefined, run: () => T): T {
  return config ? workspaceConfig.run(config, run) : run();
}

function openClawStateDir(): string {
  return process.env.OPENCLAW_STATE_DIR?.trim() || join(homedir(), ".openclaw");
}

function readLocalWorkspaceConfig(): OpenClawWorkspaceConfig {
  const path = process.env.OPENCLAW_CONFIG_PATH?.trim() || join(openClawStateDir(), "openclaw.json");
  try {
    return JSON5.parse(readFileSync(path, "utf8")) as OpenClawWorkspaceConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error("Could not read the OpenClaw workspace configuration");
  }
}

export function getWorkspaceAgent(agent?: string | null): string {
  if (!agent) throw new Error("workspace_agent must be specified explicitly");
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(agent)) throw new Error("Invalid workspace agent ID");
  return agent.toLowerCase();
}

export function getWorkspaceRoot(agent?: string | null): string {
  const id = getWorkspaceAgent(agent);
  const agents = (workspaceConfig.getStore() ?? readLocalWorkspaceConfig()).agents;
  const entry = Object.hasOwn(agents?.entries ?? {}, id) ? agents?.entries?.[id] : undefined;
  const configured = entry?.workspace ?? agents?.list?.find((candidate) => candidate.id === id)?.workspace;
  const root = configured?.trim();
  if (root === "~") return homedir();
  if (root?.startsWith("~/")) return resolve(homedir(), root.slice(2));
  return resolve(root || join(openClawStateDir(), `workspace-${id}`));
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
