/**
 * Printing Press adapter plugin — OpenClaw plugin shim.
 *
 * Dynamically registers tools from Printing Press CLIs by introspecting the
 * binary itself (via Cobra __complete / --help), or from tools-manifest.json
 * files when available.
 */

import { Type } from "@sinclair/typebox";
import {
  loadToolsManifest,
  resolveTools,
  type CliConfig,
  type ResolvedTool,
  type PPToolParam,
} from "./manifest.js";
import { introspectCli } from "./introspect.js";
import { validateBinaryPath } from "./security.js";
import { executeCli } from "./executor.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PluginApi = {
  registerTool: (tool: unknown) => void;
  pluginConfig?: Record<string, unknown>;
};

interface PluginConfig {
  clis: CliConfig[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data) }],
    details: {},
  };
}

/**
 * Convert PP param type to TypeBox schema.
 */
function paramToSchema(param: PPToolParam) {
  const desc = param.description ?? `Parameter: ${param.name}`;

  switch (param.type) {
    case "integer":
    case "number":
      return Type.Number({ description: desc });
    case "boolean":
      return Type.Boolean({ description: desc });
    case "array":
      return Type.Array(Type.String(), { description: desc });
    default:
      return Type.String({ description: desc });
  }
}

/**
 * Build TypeBox parameters schema from PP tool params.
 */
function buildParametersSchema(params: PPToolParam[]) {
  const properties: Record<string, ReturnType<typeof paramToSchema>> = {};

  for (const param of params) {
    if (param.required) {
      properties[param.name] = paramToSchema(param);
    } else {
      properties[param.name] = Type.Optional(paramToSchema(param));
    }
  }

  return Type.Object(properties);
}

function buildConfig(pluginConfig?: Record<string, unknown>): PluginConfig {
  const clis = pluginConfig?.clis;
  if (!Array.isArray(clis) || clis.length === 0) {
    throw new Error("printing-press plugin requires at least one CLI in 'clis' configuration");
  }

  return {
    clis: clis.map((cli: unknown) => {
      const c = cli as Record<string, unknown>;
      if (!c.name || !c.binaryPath) {
        throw new Error("Each CLI requires 'name' and 'binaryPath'");
      }
      return {
        name: String(c.name),
        binaryPath: String(c.binaryPath),
        manifestPath: c.manifestPath ? String(c.manifestPath) : undefined,
        env: (c.env as Record<string, string>) ?? undefined,
        allowedTools: Array.isArray(c.allowedTools)
          ? (c.allowedTools as string[])
          : undefined,
        blockedMethods: Array.isArray(c.blockedMethods)
          ? (c.blockedMethods as string[])
          : undefined,
        blockedCommands: Array.isArray(c.blockedCommands)
          ? (c.blockedCommands as string[])
          : undefined,
        timeout: typeof c.timeout === "number" ? c.timeout : undefined,
        maxTools: typeof c.maxTools === "number" ? c.maxTools : undefined,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    clis: {
      type: "array" as const,
      description: "List of Printing Press CLIs to expose as tools",
      items: {
        type: "object" as const,
        properties: {
          name: { type: "string" as const, description: "Short identifier for this CLI (e.g. 'weather')" },
          binaryPath: { type: "string" as const, description: "Absolute path to the CLI binary" },
          manifestPath: { type: "string" as const, description: "Path to tools-manifest.json (optional — uses CLI introspection if omitted)" },
          env: { type: "object" as const, description: "Environment variables for this CLI" },
          allowedTools: { type: "array" as const, description: "Whitelist of tool names to register (registers all tools if omitted)" },
          blockedMethods: { type: "array" as const, description: "HTTP methods to block for manifest mode (default: DELETE, PUT, PATCH)" },
          blockedCommands: { type: "array" as const, description: "Additional commands to skip in introspection mode" },
          timeout: { type: "number" as const, description: "Execution timeout in ms (default: 30000)" },
          maxTools: { type: "number" as const, description: "Maximum number of tools to register per CLI (default: 50)" },
        },
        required: ["name", "binaryPath"],
      },
    },
  },
  required: ["clis"],
};

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

function createEntry() {
  return {
    id: "printing-press",
    name: "Printing Press",
    description: "Expose Printing Press CLI tools as OpenClaw tools — no shell access required",
    contracts: { tools: [] as string[] },
    configSchema,
    register(api: PluginApi) {
      const config = buildConfig(api.pluginConfig);
      const allToolNames: string[] = [];

      for (const cliConfig of config.clis) {
        try {
          // Validate binary
          validateBinaryPath(cliConfig.binaryPath);

          let tools: ResolvedTool[];

          if (cliConfig.manifestPath) {
            // Manifest mode — use tools-manifest.json
            const manifest = loadToolsManifest(cliConfig.manifestPath);
            tools = resolveTools(manifest, cliConfig);
            console.log(
              `[printing-press] ${cliConfig.name}: registering ${tools.length} tools ` +
              `from manifest (${manifest.api_name})`
            );
          } else {
            // Introspection mode — discover tools from CLI
            tools = introspectCli(cliConfig);
            console.log(
              `[printing-press] ${cliConfig.name}: registering ${tools.length} tools ` +
              `via CLI introspection`
            );
          }

          for (const resolved of tools) {
            registerTool(api, resolved);
            allToolNames.push(resolved.toolName);
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[printing-press] Failed to load CLI '${cliConfig.name}': ${msg}`);
        }
      }

      // Register a discovery meta-tool
      api.registerTool({
        name: "pp_list_tools",
        label: "Printing Press: List Tools",
        description:
          "List all available Printing Press tools. Use this to discover what tools are available before calling them.",
        parameters: Type.Object({
          cli: Type.Optional(
            Type.String({ description: "Filter by CLI name (e.g. 'linear')" }),
          ),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const cliFilter = ((params.cli as string) ?? "").trim().toLowerCase();
          const filtered = cliFilter
            ? allToolNames.filter((n) => n.startsWith(`pp_${cliFilter}_`))
            : allToolNames;
          return formatResult({
            output: {
              total: filtered.length,
              tools: filtered,
            },
          });
        },
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

function registerTool(api: PluginApi, resolved: ResolvedTool): void {
  const { toolName, subcommand, ppTool, cliConfig } = resolved;
  const methodTag = ppTool.method.toUpperCase() !== "GET" ? ` [${ppTool.method}]` : "";

  // Build description with positional arg hints
  const positionalParams = ppTool.params.filter((p) => p.location === "positional");
  const posHint = positionalParams.length > 0
    ? ` — args: ${positionalParams.map((p) => p.required ? `<${p.name}>` : `[${p.name}]`).join(" ")}`
    : "";

  api.registerTool({
    name: toolName,
    label: `PP: ${cliConfig.name} — ${subcommand.join(" ")}`,
    description: `${ppTool.description}${methodTag}${posHint}`,
    parameters: buildParametersSchema(ppTool.params),
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      try {
        const result = await executeCli({
          binaryPath: cliConfig.binaryPath,
          subcommand,
          params,
          paramDefs: ppTool.params,
          env: cliConfig.env,
          timeout: cliConfig.timeout,
        });

        return formatResult(result.output);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return formatResult({ error: msg });
      }
    },
  });
}

export { createEntry };
