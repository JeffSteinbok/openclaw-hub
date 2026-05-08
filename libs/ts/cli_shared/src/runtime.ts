/**
 * @openclaw/cli-shared — runtime
 *
 * Generic CLI runner that introspects a plugin's createEntry() metadata
 * and exposes each tool as a subcommand.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolParam {
  type: string;
  description?: string;
  items?: { type: string };
  minItems?: number;
  enum?: string[];
}

interface ToolSchema {
  type: "object";
  properties: Record<string, ToolParam>;
  required?: string[];
}

interface Tool {
  name: string;
  label?: string;
  description?: string;
  parameters?: ToolSchema;
  execute(toolCallId: string, params: Record<string, unknown>): Promise<unknown>;
}

interface PluginEntry {
  id: string;
  name: string;
  description?: string;
  configSchema?: {
    properties?: Record<string, { type: string; description?: string }>;
  };
  register(api: { registerTool: (tool: Tool) => void; pluginConfig?: Record<string, unknown> }): void;
}

export interface RunOptions {
  /** Prefix for env var mapping. E.g. "STOCK_QUOTES" → STOCK_QUOTES_FINNHUB_API_KEY */
  envPrefix?: string;
  /** Override the binary name shown in help */
  binName?: string;
}

// ---------------------------------------------------------------------------
// Env → config mapping
// ---------------------------------------------------------------------------

function envVarName(prefix: string, field: string): string {
  // camelCase → SCREAMING_SNAKE: finnhubApiKey → FINNHUB_API_KEY
  const snake = field.replace(/([A-Z])/g, "_$1").toUpperCase();
  return `${prefix}_${snake}`;
}

function buildConfigFromEnv(
  prefix: string,
  schema?: PluginEntry["configSchema"],
): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (!schema?.properties) return config;

  for (const [field, def] of Object.entries(schema.properties)) {
    const envName = envVarName(prefix, field);
    const val = process.env[envName]?.trim();
    if (val) {
      config[field] = def.type === "number" ? Number(val) : val;
    }
  }
  return config;
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  command: string | null;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let command: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          flags[arg.slice(2)] = next;
          i++;
        } else {
          flags[arg.slice(2)] = true;
        }
      }
    } else if (!command) {
      command = arg;
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, flags };
}

// ---------------------------------------------------------------------------
// Help generation
// ---------------------------------------------------------------------------

function printHelp(entry: PluginEntry, tools: Tool[], binName: string, envPrefix?: string) {
  console.log(`${binName} — ${entry.description ?? entry.name}\n`);
  console.log("Usage:");
  console.log(`  ${binName} <command> [args...] [--json]\n`);
  console.log("Commands:");

  for (const tool of tools) {
    const params = tool.parameters?.properties
      ? Object.keys(tool.parameters.properties)
          .map((p) => {
            const schema = tool.parameters!.properties[p];
            return schema.type === "array" ? `<${p}...>` : `<${p}>`;
          })
          .join(" ")
      : "";
    const cmdName = tool.name.replace(/_/g, "-");
    console.log(`  ${cmdName.padEnd(20)} ${params.padEnd(20)} ${tool.description ?? ""}`);
  }

  console.log("\nOptions:");
  console.log("  --json            Output raw JSON");
  console.log("  --help, -h        Show this help");

  if (envPrefix && entry.configSchema?.properties) {
    console.log("\nEnvironment:");
    for (const [field, def] of Object.entries(entry.configSchema.properties)) {
      const envName = envVarName(envPrefix, field);
      console.log(`  ${envName.padEnd(30)} ${def.description ?? ""}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function formatPretty(result: unknown): string {
  if (result == null) return "";

  // Handle plugin formatResult wrapper
  const content = (result as { content?: { text?: string }[] })?.content;
  if (Array.isArray(content) && content[0]?.text) {
    try {
      const parsed = JSON.parse(content[0].text);
      return formatPrettyValue(parsed);
    } catch {
      return content[0].text;
    }
  }

  return formatPrettyValue(result);
}

function formatPrettyValue(val: unknown): string {
  if (typeof val === "string") return val;
  if (typeof val !== "object" || val === null) return String(val);

  // Error object
  if ("error" in val) return `Error: ${(val as { error: string }).error}`;

  // Array of items
  if (Array.isArray(val)) {
    return val.map((item) => formatPrettyValue(item)).join("\n");
  }

  // Object with quotes array (stock-quotes multi response)
  if ("quotes" in val && Array.isArray((val as { quotes: unknown[] }).quotes)) {
    const multi = val as { quotes: unknown[]; errors?: { symbol: string; error: string }[] | null };
    const lines = multi.quotes.map((q) => formatPrettyValue(q));
    if (multi.errors) {
      for (const e of multi.errors) {
        lines.push(`${e.symbol}: ${e.error}`);
      }
    }
    return lines.join("\n");
  }

  // Generic object — try to make a readable line
  // Check for stock-quote-like shape
  if ("symbol" in val && "price" in val) {
    const q = val as { symbol: string; price: number | null; change: number | null; change_percent: number | null; market_state: string };
    const arrow = (q.change ?? 0) >= 0 ? "▲" : "▼";
    const sign = (q.change ?? 0) >= 0 ? "+" : "";
    const changeStr = q.change != null ? `${sign}${q.change} (${sign}${q.change_percent}%)` : "n/a";
    return `${q.symbol}  $${q.price?.toFixed(2) ?? "—"}  ${arrow} ${changeStr}  [${q.market_state}]`;
  }

  // Fallback: JSON
  return JSON.stringify(val, null, 2);
}

// ---------------------------------------------------------------------------
// Tool matching
// ---------------------------------------------------------------------------

function matchTool(tools: Tool[], command: string): Tool | undefined {
  // Try exact match on name
  const exact = tools.find((t) => t.name === command);
  if (exact) return exact;

  // Try with underscores replaced by hyphens
  const normalized = command.replace(/-/g, "_");
  const norm = tools.find((t) => t.name === normalized);
  if (norm) return norm;

  // Try matching just the suffix (e.g. "quote" matches "stock_quote")
  const suffix = tools.find((t) => t.name.endsWith(`_${normalized}`));
  if (suffix) return suffix;

  // Single tool? Use it regardless of command name
  if (tools.length === 1) return tools[0];

  return undefined;
}

function buildParams(tool: Tool, positional: string[], flags: Record<string, string | boolean>): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const schema = tool.parameters?.properties;
  if (!schema) return params;

  const paramNames = Object.keys(schema);
  let posIdx = 0;

  for (const name of paramNames) {
    const def = schema[name];

    // Check flags first
    const flagName = name.replace(/_/g, "-");
    if (flagName in flags) {
      params[name] = flags[flagName];
      continue;
    }
    if (name in flags) {
      params[name] = flags[name];
      continue;
    }

    // Array type: consume all remaining positional args
    if (def.type === "array") {
      params[name] = positional.slice(posIdx);
      posIdx = positional.length;
      continue;
    }

    // Single positional
    if (posIdx < positional.length) {
      params[name] = positional[posIdx++];
    }
  }

  return params;
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

export async function run(entry: PluginEntry, options: RunOptions = {}): Promise<void> {
  const binName = options.binName ?? entry.id;
  const envPrefix = options.envPrefix ?? entry.id.replace(/-/g, "_").toUpperCase();

  // Capture tools via mock register
  const tools: Tool[] = [];
  const config = buildConfigFromEnv(envPrefix, entry.configSchema);

  entry.register({
    registerTool: (tool: Tool) => tools.push(tool),
    pluginConfig: config,
  });

  // Parse args
  const argv = process.argv.slice(2);
  const { command, positional, flags } = parseArgs(argv);

  // Help
  if (flags.help || flags.h || (!command && positional.length === 0)) {
    printHelp(entry, tools, binName, envPrefix);
    process.exit(0);
  }

  const json = !!flags.json;
  delete flags.json;
  delete flags.help;
  delete flags.h;

  // Find matching tool
  const tool = matchTool(tools, command ?? "");
  if (!tool) {
    console.error(`Unknown command: ${command}`);
    console.error(`Run \`${binName} --help\` for available commands.`);
    process.exit(1);
  }

  // If command matches but user passed symbols as the "command" (convenience: `stock-quotes MSFT`)
  // and there's only one tool — treat command as first positional
  let effectivePositional = positional;
  if (tools.length === 1 && command && !tools.find((t) => t.name === command.replace(/-/g, "_"))) {
    effectivePositional = [command, ...positional];
  }

  // Build params from positional args + flags
  const params = buildParams(tool, effectivePositional, flags);

  // Execute
  try {
    const result = await tool.execute("cli", params);

    if (json) {
      // Unwrap formatResult wrapper if present
      const content = (result as { content?: { text?: string }[] })?.content;
      if (Array.isArray(content) && content[0]?.text) {
        try {
          const parsed = JSON.parse(content[0].text);
          console.log(JSON.stringify(parsed, null, 2));
        } catch {
          console.log(content[0].text);
        }
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
    } else {
      const output = formatPretty(result);
      if (output) console.log(output);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}
