/**
 * Introspect — discover tools from Printing Press CLIs at startup.
 *
 * Uses Cobra's __complete and --help to discover commands, flags, and
 * positional args without requiring a tools-manifest.json.
 */

import { execFileSync } from "node:child_process";
import { buildSafeEnv } from "./security.js";
import type { PPToolParam, PPTool, ResolvedTool, CliConfig } from "./manifest.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INTROSPECT_TIMEOUT = 5_000;
const MAX_DEPTH = 3;

/** Global PP flags present on every command — excluded from tool params. */
const GLOBAL_FLAGS = new Set([
  "agent", "compact", "config", "csv", "data-source", "deliver",
  "dry-run", "human-friendly", "json", "no-cache", "no-color",
  "no-input", "plain", "profile", "quiet", "rate-limit", "select",
  "timeout", "yes", "help", "version",
]);

/** Commands that are internal/admin and should not be registered as tools. */
const SKIP_COMMANDS = new Set([
  "help", "completion", "config", "auth", "doctor", "version",
  "feedback", "profile", "import", "export", "sync", "tail",
  "watch", "api",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiscoveredCommand {
  name: string;
  description: string;
  path: string[];           // e.g. ["workflow", "archive"]
  flags: DiscoveredFlag[];
  positionals: DiscoveredPositional[];
}

interface DiscoveredFlag {
  longName: string;         // e.g. "forecast-days"
  type: string;             // cobra type: string, int, float, bool, duration, etc.
  description: string;
  required: boolean;
  defaultValue?: string;
}

interface DiscoveredPositional {
  name: string;             // e.g. "location"
  required: boolean;        // <name> = required, [name] = optional
}

// ---------------------------------------------------------------------------
// Exec helper
// ---------------------------------------------------------------------------

function runBinary(
  binaryPath: string,
  args: string[],
  env: Record<string, string>,
  timeout: number,
): string {
  try {
    const result = execFileSync(binaryPath, args, {
      env,
      timeout,
      maxBuffer: 1024 * 1024,
      cwd: "/tmp",
      shell: false,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result;
  } catch (e: unknown) {
    // execFileSync throws on non-zero exit but stdout may still have data
    if (e && typeof e === "object" && "stdout" in e) {
      return String((e as { stdout: unknown }).stdout);
    }
    return "";
  }
}

// ---------------------------------------------------------------------------
// __complete output parser
// ---------------------------------------------------------------------------

interface CompletionEntry {
  name: string;
  description: string;
}

/**
 * Parse `__complete` output into command/flag entries.
 * Format: `name\tdescription` lines, ending with `:N\nCompletion ended with ...`
 */
export function parseCompleteOutput(output: string): CompletionEntry[] {
  const entries: CompletionEntry[] = [];

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    // Skip directive lines and empty lines
    if (!trimmed || trimmed.startsWith(":") || trimmed.startsWith("Completion ended")) {
      continue;
    }

    const tabIdx = trimmed.indexOf("\t");
    if (tabIdx > 0) {
      entries.push({
        name: trimmed.slice(0, tabIdx),
        description: trimmed.slice(tabIdx + 1).trim(),
      });
    } else {
      // No description
      entries.push({ name: trimmed, description: "" });
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// --help output parser
// ---------------------------------------------------------------------------

/**
 * Parse flag definitions from `--help` output.
 *
 * Cobra flag format:
 *   -s, --long-name type    Description (default "value")
 *       --long-name type    Description (default "value")
 *       --bool-flag         Description
 *
 * Types: string, strings, stringArray, int, ints, intSlice,
 *        float, float32, float64, bool, duration, count
 */
const FLAG_RE = /^\s+(?:-\w,\s+)?--(\S+?)(?:\s+(string|strings|stringArray|int|ints|intSlice|int32|int64|float|float32|float64|bool|duration|count|uint|uint8|uint16|uint32|uint64|bytesHex|bytesBase64|ip|ipMask|ipNet))?(?:\s{2,}(.+))?$/;

export function parseHelpFlags(helpOutput: string): DiscoveredFlag[] {
  const flags: DiscoveredFlag[] = [];
  const inGlobal = { value: false };

  for (const line of helpOutput.split("\n")) {
    // Track section headers to separate local vs global flags
    if (/^Global Flags:/i.test(line.trim())) {
      inGlobal.value = true;
      continue;
    }
    if (/^Flags:/i.test(line.trim())) {
      inGlobal.value = false;
      continue;
    }

    const match = FLAG_RE.exec(line);
    if (!match) continue;

    const longName = match[1];
    const cobraType = match[2] ?? "bool"; // no type = boolean
    const descriptionRaw = match[3] ?? "";

    // Skip global flags
    if (GLOBAL_FLAGS.has(longName) || inGlobal.value) continue;

    // Parse default value
    let defaultValue: string | undefined;
    const defaultMatch = /\(default\s+"?([^"]*)"?\)\s*$/.exec(descriptionRaw);
    if (defaultMatch) {
      defaultValue = defaultMatch[1];
    }

    // Check required
    const required = /\[required\]/i.test(descriptionRaw) || /\(required\)/i.test(descriptionRaw);

    // Clean description
    let description = descriptionRaw
      .replace(/\s*\(default\s+"?[^"]*"?\)\s*$/, "")
      .replace(/\s*\[required\]\s*/i, "")
      .replace(/\s*\(required\)\s*/i, "")
      .trim();

    if (!description) {
      description = `Flag: --${longName}`;
    }

    flags.push({ longName, type: cobraType, description, required, defaultValue });
  }

  return flags;
}

/**
 * Parse positional args from the Usage: line of --help output.
 * Format: `  binary command <required> [optional] [flags]`
 */
export function parsePositionals(helpOutput: string): DiscoveredPositional[] {
  const positionals: DiscoveredPositional[] = [];

  for (const line of helpOutput.split("\n")) {
    const trimmed = line.trim();
    // Match Usage lines
    if (!trimmed.startsWith("Usage:")) continue;

    // Get the actual usage pattern (next meaningful line or same line)
    break;
  }

  // Find lines after "Usage:" that contain the pattern
  const usageMatch = /Usage:\s*\n\s+\S+\s+\S+\s+(.*?)(?:\s+\[flags\])?\s*$/m.exec(helpOutput);
  if (!usageMatch) return positionals;

  const argsStr = usageMatch[1];
  // Match <required> and [optional] tokens
  const argRe = /([<\[])(\w[\w-]*)([>\]])/g;
  let m: RegExpExecArray | null;
  while ((m = argRe.exec(argsStr)) !== null) {
    const bracket = m[1];
    const name = m[2];
    // Skip [flags] — it's just the Cobra suffix
    if (name === "flags") continue;
    positionals.push({
      name,
      required: bracket === "<",
    });
  }

  return positionals;
}

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

function cobraTypeToParamType(cobraType: string): string {
  switch (cobraType) {
    case "int":
    case "int32":
    case "int64":
    case "uint":
    case "uint8":
    case "uint16":
    case "uint32":
    case "uint64":
    case "count":
      return "integer";
    case "float":
    case "float32":
    case "float64":
      return "number";
    case "bool":
      return "boolean";
    case "strings":
    case "stringArray":
    case "ints":
    case "intSlice":
      return "array";
    default:
      return "string";
  }
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

function discoverSubcommands(
  binaryPath: string,
  parentPath: string[],
  env: Record<string, string>,
  timeout: number,
  depth: number,
): DiscoveredCommand[] {
  if (depth > MAX_DEPTH) return [];

  const output = runBinary(binaryPath, ["__complete", ...parentPath, ""], env, timeout);
  const entries = parseCompleteOutput(output);

  // Separate commands from flags (flags start with --)
  const commands = entries.filter((e) => !e.name.startsWith("-"));

  if (commands.length === 0) {
    // This is a leaf command — discover its flags
    return [];
  }

  const discovered: DiscoveredCommand[] = [];

  for (const cmd of commands) {
    if (SKIP_COMMANDS.has(cmd.name)) continue;

    const cmdPath = [...parentPath, cmd.name];

    // Check for subcommands
    const subOutput = runBinary(binaryPath, ["__complete", ...cmdPath, ""], env, timeout);
    const subEntries = parseCompleteOutput(subOutput);
    const subCommands = subEntries.filter((e) => !e.name.startsWith("-"));

    if (subCommands.length > 0 && !subCommands.every((s) => SKIP_COMMANDS.has(s.name))) {
      // Has non-skipped subcommands — recurse
      const nested = discoverSubcommands(binaryPath, cmdPath, env, timeout, depth + 1);
      discovered.push(...nested);
    } else {
      // Leaf command — get flags from --help
      const helpOutput = runBinary(binaryPath, [...cmdPath, "--help"], env, timeout);
      const flags = parseHelpFlags(helpOutput);
      const positionals = parsePositionals(helpOutput);

      discovered.push({
        name: cmd.name,
        description: cmd.description,
        path: cmdPath,
        flags,
        positionals,
      });
    }
  }

  return discovered;
}

/**
 * Convert a discovered command to the PPTool + ResolvedTool shapes used
 * by the rest of the plugin.
 */
function commandToResolvedTool(
  cmd: DiscoveredCommand,
  cliConfig: CliConfig,
): ResolvedTool {
  const params: PPToolParam[] = [];

  // Positional args first
  for (const pos of cmd.positionals) {
    params.push({
      name: pos.name,
      type: "string",
      location: "positional",
      description: `Positional argument: ${pos.name}`,
      required: pos.required,
    });
  }

  // Then flags
  for (const flag of cmd.flags) {
    const paramName = flag.longName.replace(/-/g, "_");
    params.push({
      name: paramName,
      wire_name: flag.longName,
      type: cobraTypeToParamType(flag.type),
      location: "flag",
      description: flag.description,
      required: flag.required,
    });
  }

  const toolName = `pp_${cliConfig.name}_${cmd.path.join("_").replace(/-/g, "_")}`;
  const ppTool: PPTool = {
    name: cmd.path.join("_"),
    description: cmd.description,
    method: "GET",   // Introspected commands are treated as read-only
    path: "",
    params,
  };

  return {
    toolName,
    subcommand: cmd.path,
    ppTool,
    cliConfig,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover tools from a PP CLI binary via __complete and --help introspection.
 * Returns ResolvedTool[] compatible with the manifest-based flow.
 */
export function introspectCli(cliConfig: CliConfig): ResolvedTool[] {
  const env = buildSafeEnv(cliConfig.env);
  const timeout = Math.min(cliConfig.timeout ?? INTROSPECT_TIMEOUT, INTROSPECT_TIMEOUT);

  // Also check if top-level commands are themselves leaf (no subcommands)
  const output = runBinary(cliConfig.binaryPath, ["__complete", ""], env, timeout);
  const topEntries = parseCompleteOutput(output);
  const topCommands = topEntries.filter((e) => !e.name.startsWith("-") && !SKIP_COMMANDS.has(e.name));

  const discovered: DiscoveredCommand[] = [];

  for (const cmd of topCommands) {
    const cmdPath = [cmd.name];

    // Check for subcommands
    const subOutput = runBinary(cliConfig.binaryPath, ["__complete", ...cmdPath, ""], env, timeout);
    const subEntries = parseCompleteOutput(subOutput);
    const subCommands = subEntries.filter((e) => !e.name.startsWith("-"));

    if (subCommands.length > 0 && !subCommands.every((s) => SKIP_COMMANDS.has(s.name))) {
      // Recurse into subcommands
      const nested = discoverSubcommands(cliConfig.binaryPath, cmdPath, env, timeout, 1);
      if (nested.length > 0) {
        discovered.push(...nested);
      } else {
        // Parent has subcommands but they're all skippable — register parent if it's runnable
        const helpOutput = runBinary(cliConfig.binaryPath, [...cmdPath, "--help"], env, timeout);
        if (/^Usage:/m.test(helpOutput)) {
          const flags = parseHelpFlags(helpOutput);
          const positionals = parsePositionals(helpOutput);
          discovered.push({
            name: cmd.name,
            description: cmd.description,
            path: cmdPath,
            flags,
            positionals,
          });
        }
      }
    } else {
      // Leaf command
      const helpOutput = runBinary(cliConfig.binaryPath, [...cmdPath, "--help"], env, timeout);
      const flags = parseHelpFlags(helpOutput);
      const positionals = parsePositionals(helpOutput);
      discovered.push({
        name: cmd.name,
        description: cmd.description,
        path: cmdPath,
        flags,
        positionals,
      });
    }
  }

  // Apply maxTools cap
  const maxTools = cliConfig.maxTools ?? 50;

  // Apply allowedTools filter if present
  let resolved = discovered.map((cmd) => commandToResolvedTool(cmd, cliConfig));

  if (cliConfig.allowedTools) {
    const allowed = new Set(cliConfig.allowedTools.map((t) => t.toLowerCase()));
    resolved = resolved.filter((r) =>
      allowed.has(r.toolName.toLowerCase()) ||
      allowed.has(r.ppTool.name.toLowerCase()) ||
      allowed.has(r.subcommand.join("_").toLowerCase())
    );
  }

  return resolved.slice(0, maxTools);
}
