/**
 * Workspace path helpers for USPS analysis data.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import JSON5 from "json5";

type WorkspaceEntry = { workspace?: string; default?: boolean };
export type OpenClawWorkspaceConfig = {
  agents?: {
    entries?: Record<string, WorkspaceEntry>;
    list?: Array<WorkspaceEntry & { id: string }>;
    defaults?: WorkspaceEntry;
    ownership?: string;
  };
};
type WorkspaceResolver = (config: OpenClawWorkspaceConfig, agentId: string) => string;
const workspaceConfig = new AsyncLocalStorage<{
  config: OpenClawWorkspaceConfig;
  resolveWorkspace?: WorkspaceResolver;
}>();
const warnedLegacyFiles = new Set<string>();

export function withWorkspaceConfig<T>(
  config: OpenClawWorkspaceConfig | undefined,
  run: () => T,
  resolveWorkspace?: WorkspaceResolver,
): T {
  return config ? workspaceConfig.run({ config, resolveWorkspace }, run) : run();
}

function openClawStateDir(): string {
  const profile = process.env.OPENCLAW_PROFILE?.trim();
  const directory = profile && profile.toLowerCase() !== "default" ? `.openclaw-${profile}` : ".openclaw";
  return resolve(process.env.OPENCLAW_STATE_DIR?.trim() || join(homedir(), directory));
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
  const id = agent?.trim().toLowerCase();
  if (!id) throw new Error("workspace_agent must be specified explicitly");
  if (/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) return id;
  const normalized = id.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  if (!normalized) throw new Error("Invalid workspace agent ID");
  return normalized;
}

function expandPath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return resolve(path);
}

export function getWorkspaceRoot(agent?: string | null): string {
  const id = getWorkspaceAgent(agent);
  const scope = workspaceConfig.getStore();
  const config = scope?.config ?? readLocalWorkspaceConfig();
  if (scope?.resolveWorkspace) return scope.resolveWorkspace(config, id);
  const agents = config.agents;
  const roster = agents?.entries
    ? Object.entries(agents.entries).map(([id, entry]) => ({ ...entry, id }))
    : agents?.list;
  const configured = roster?.find((candidate) => getWorkspaceAgent(candidate.id) === id)?.workspace?.trim();
  if (configured) return expandPath(configured);

  const explicitDefaults = roster?.filter((candidate) => candidate.default);
  const defaultId = agents?.ownership !== "explicit" && explicitDefaults?.length === 1
    ? getWorkspaceAgent(explicitDefaults[0].id)
    : roster?.length === 1 ? getWorkspaceAgent(roster[0].id) : roster ? undefined : "main";
  const defaultRoot = agents?.defaults?.workspace?.trim();
  if (id === defaultId) {
    return expandPath(defaultRoot || process.env.OPENCLAW_WORKSPACE_DIR?.trim() || join(openClawStateDir(), "workspace"));
  }
  return defaultRoot ? join(expandPath(defaultRoot), id) : join(openClawStateDir(), `workspace-${id}`);
}

function existingWorkspaceFile(agent: string | null | undefined, ...parts: string[]): string {
  const id = getWorkspaceAgent(agent);
  const target = join(getWorkspaceRoot(id), ...parts);
  if (existsSync(target)) return target;
  const legacy = join(openClawStateDir(), "agents", id, "workspace", ...parts);
  if (!existsSync(legacy)) return target;
  if (!warnedLegacyFiles.has(legacy)) {
    warnedLegacyFiles.add(legacy);
    console.warn(`USPS workspace for ${id} uses legacy ${parts.join("/")}; move it to the configured workspace.`);
  }
  return legacy;
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
  return existingWorkspaceFile(agent, "memory", "usps_analysis.json");
}

export function getStateFile(agent?: string | null): string {
  return existingWorkspaceFile(agent, "memory", "usps_state.json");
}

export function getRulesFile(agent?: string | null): string {
  return existingWorkspaceFile(agent, "usps-mail", "rules.json");
}

export function getConfigFile(agent?: string | null): string {
  return existingWorkspaceFile(agent, "usps-mail", "config.json");
}
