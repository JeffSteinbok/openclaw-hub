/**
 * Executor — CLI binary execution with security constraints.
 *
 * Spawns Printing Press CLIs via execFile (no shell), captures JSON output,
 * enforces timeouts and output limits.
 */

import { execFile } from "node:child_process";
import { buildSafeEnv } from "./security.js";
import type { PPToolParam } from "./manifest.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecConfig {
  binaryPath: string;
  subcommand: string[];
  params: Record<string, unknown>;
  paramDefs: PPToolParam[];
  env?: Record<string, string>;
  timeout?: number;
  cwd?: string;
}

export interface ExecResult {
  output: unknown;
  exitCode: number;
}

// ---------------------------------------------------------------------------
// Argument building
// ---------------------------------------------------------------------------

const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

/**
 * Build CLI arguments from tool params.
 * Uses --flag=value form to prevent argument injection.
 * Positional args are placed after the subcommand, before flags.
 */
export function buildArgs(
  subcommand: string[],
  params: Record<string, unknown>,
  paramDefs: PPToolParam[],
): string[] {
  const args = [...subcommand];

  // Build a set of valid param names from definitions
  const validParams = new Map(paramDefs.map((p) => [p.name, p]));

  // Collect positional args first (ordered by definition order)
  const positionals: string[] = [];
  const flagArgs: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    const def = validParams.get(key);
    if (!def) continue;
    if (value === undefined || value === null) continue;

    if (def.location === "positional") {
      positionals.push(String(value));
      continue;
    }

    // Use wire_name if available (preserves original CLI flag name),
    // otherwise convert underscores to hyphens
    const flagName = def.wire_name ?? key.replace(/_/g, "-");

    if (typeof value === "boolean") {
      if (value) flagArgs.push(`--${flagName}`);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        flagArgs.push(`--${flagName}=${String(item)}`);
      }
    } else {
      flagArgs.push(`--${flagName}=${String(value)}`);
    }
  }

  // Positionals → then agent defaults → then user flags
  args.push(...positionals, "--json", "--compact", "--quiet", ...flagArgs);

  return args;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT = 30_000;

/**
 * Execute a Printing Press CLI command.
 * Uses execFile (no shell) with a scoped environment.
 */
export function executeCli(config: ExecConfig): Promise<ExecResult> {
  const args = buildArgs(config.subcommand, config.params, config.paramDefs);
  const env = buildSafeEnv(config.env);
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;

  return new Promise((resolve, reject) => {
    const child = execFile(
      config.binaryPath,
      args,
      {
        env,
        timeout,
        maxBuffer: MAX_BUFFER,
        cwd: config.cwd ?? "/tmp",
        // No shell — critical for security
        shell: false,
      },
      (error, stdout, stderr) => {
        const exitCode = error && "code" in error
          ? (typeof error.code === "number" ? error.code : 1)
          : 0;

        // Handle timeout
        if (error && "killed" in error && error.killed) {
          resolve({
            output: { error: `CLI timed out after ${timeout}ms` },
            exitCode: 124,
          });
          return;
        }

        // Try to parse JSON from stdout
        const trimmed = stdout.trim();
        if (trimmed) {
          try {
            const parsed = JSON.parse(trimmed);
            resolve({ output: parsed, exitCode });
            return;
          } catch {
            // Not JSON — return as text
          }
        }

        // Non-JSON or empty output
        if (exitCode !== 0) {
          const errMsg = stderr.trim() || stdout.trim() || error?.message || "Unknown error";
          resolve({
            output: { error: errMsg.slice(0, 2000) },
            exitCode,
          });
        } else {
          resolve({
            output: trimmed || { message: "Command completed successfully with no output" },
            exitCode: 0,
          });
        }
      },
    );

    // Kill process group on timeout if possible
    child.on("error", (err) => {
      reject(new Error(`Failed to execute CLI: ${err.message}`));
    });
  });
}
