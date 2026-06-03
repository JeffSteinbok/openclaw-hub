/**
 * Manifest — tools-manifest.json parser and tool name mapping.
 *
 * Reads Printing Press manifests and converts them to Carapace-compatible
 * tool definitions.
 */

import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PPToolParam {
  name: string;
  wire_name?: string;
  type: string;
  location: string;
  description?: string;
  required?: boolean;
}

export interface PPTool {
  name: string;
  description: string;
  method: string;
  path: string;
  params: PPToolParam[];
}

export interface PPToolsManifest {
  api_name: string;
  base_url: string;
  description: string;
  mcp_ready: string;
  auth: {
    type: string;
    env_vars?: string[];
  };
  tools: PPTool[];
}

export interface CliConfig {
  name: string;
  binaryPath: string;
  manifestPath?: string;
  env?: Record<string, string>;
  allowedTools?: string[];
  blockedMethods?: string[];
  blockedCommands?: string[];
  timeout?: number;
  maxTools?: number;
}

export interface ResolvedTool {
  /** Carapace tool name, e.g. pp_linear_issues_list */
  toolName: string;
  /** CLI subcommand path, e.g. ["issues", "list"] */
  subcommand: string[];
  /** Original PP tool definition */
  ppTool: PPTool;
  /** CLI config this tool belongs to */
  cliConfig: CliConfig;
}

// ---------------------------------------------------------------------------
// Manifest loading
// ---------------------------------------------------------------------------

export function loadToolsManifest(manifestPath: string): PPToolsManifest {
  const raw = readFileSync(manifestPath, "utf-8");
  const data = JSON.parse(raw) as PPToolsManifest;

  if (!data.api_name || !Array.isArray(data.tools)) {
    throw new Error(`Invalid tools-manifest.json at ${manifestPath}: missing api_name or tools`);
  }

  return data;
}

// ---------------------------------------------------------------------------
// Tool name mapping
// ---------------------------------------------------------------------------

/**
 * Convert a PP tool name to a Carapace tool name.
 * PP: "audio-isolation_audio_isolation"
 * Carapace: "pp_elevenlabs_audio_isolation_audio_isolation"
 */
export function toToolName(cliName: string, ppToolName: string): string {
  // Replace hyphens with underscores for consistent naming
  const sanitized = ppToolName.replace(/-/g, "_");
  return `pp_${cliName}_${sanitized}`;
}

/**
 * Convert a PP tool name to CLI subcommand path.
 * PP: "audio-isolation_audio_isolation" → ["audio-isolation", "audio-isolation"]
 * PP: "registrar_domain-search" → ["registrar", "domain-search"]
 *
 * Convention: underscores separate subcommand levels, hyphens are within a level.
 */
export function toSubcommand(ppToolName: string): string[] {
  return ppToolName.split("_").filter(Boolean);
}

// ---------------------------------------------------------------------------
// Tool resolution
// ---------------------------------------------------------------------------

const DEFAULT_BLOCKED_METHODS = ["DELETE", "PUT", "PATCH"];
const DEFAULT_MAX_TOOLS = 50;

/**
 * Resolve which tools from a manifest should be registered, applying filters.
 */
export function resolveTools(manifest: PPToolsManifest, config: CliConfig): ResolvedTool[] {
  const blockedMethods = new Set(
    (config.blockedMethods ?? DEFAULT_BLOCKED_METHODS).map((m) => m.toUpperCase())
  );
  const maxTools = config.maxTools ?? DEFAULT_MAX_TOOLS;
  const allowedSet = config.allowedTools
    ? new Set(config.allowedTools.map((t) => t.toLowerCase()))
    : null;

  const resolved: ResolvedTool[] = [];

  for (const tool of manifest.tools) {
    // Apply allowlist filter
    if (allowedSet && !allowedSet.has(tool.name.toLowerCase())) {
      continue;
    }

    // Apply method blocklist (only when no explicit allowlist)
    if (!allowedSet && blockedMethods.has(tool.method.toUpperCase())) {
      continue;
    }

    resolved.push({
      toolName: toToolName(config.name, tool.name),
      subcommand: toSubcommand(tool.name),
      ppTool: tool,
      cliConfig: config,
    });

    if (resolved.length >= maxTools) break;
  }

  return resolved;
}
