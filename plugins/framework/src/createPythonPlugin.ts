import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

function callPythonSync(script: string, payload: unknown): unknown {
  const result = execFileSync("python3", [script], {
    input: JSON.stringify(payload),
    encoding: "utf-8",
    timeout: 10_000,
  });
  return JSON.parse(result);
}

function callPythonAsync(script: string, payload: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [script]);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d: Buffer) => (stdout += d));
    proc.stderr.on("data", (d: Buffer) => (stderr += d));

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Python exited ${code}: ${stderr}`));
      } else {
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`Invalid JSON from Python: ${stdout}`));
        }
      }
    });

    proc.stdin.write(JSON.stringify(payload));
    proc.stdin.end();
  });
}

// Convert a JSON Schema object into a TypeBox-compatible TSchema.
// OpenClaw/pi-agent-core expects parameters to have Symbol metadata,
// but in practice it reads .type and .properties, so we just need to
// ensure the shape is correct with the Kind/Type symbols TypeBox uses.
function toTSchema(jsonSchema: Record<string, unknown>): unknown {
  const schema = { ...jsonSchema } as Record<string | symbol, unknown>;
  // TypeBox uses Symbol.for("TypeBox.Kind") and Symbol.for("TypeBox.Type")
  const KindSymbol = Symbol.for("TypeBox.Kind");
  const TypeSymbol = Symbol.for("TypeBox.Type");
  schema[KindSymbol] = "Object";
  schema[TypeSymbol] = "Object";

  // Ensure properties exist
  if (!schema.properties) {
    schema.properties = {};
  }

  return schema;
}

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface Manifest {
  tools: ToolDef[];
}

interface PluginApi {
  registerTool: (tool: unknown, opts?: unknown) => void;
}

/**
 * Register Python-backed tools with OpenClaw.
 * Registration is SYNCHRONOUS (required by OpenClaw plugin lifecycle).
 * Tool execution spawns Python asynchronously per call.
 */
export function createPythonPlugin(
  api: PluginApi,
  options: { script: URL; manifest?: URL }
) {
  const scriptPath =
    options.script.protocol === "file:"
      ? fileURLToPath(options.script)
      : options.script.pathname;

  // Get manifest synchronously — either from a pre-built JSON file or by spawning Python
  let manifest: Manifest;
  if (options.manifest) {
    const manifestPath =
      options.manifest.protocol === "file:"
        ? fileURLToPath(options.manifest)
        : options.manifest.pathname;
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } else {
    manifest = callPythonSync(scriptPath, { method: "manifest" }) as Manifest;
  }

  for (const tool of manifest.tools) {
    const toolName = tool.name;

    api.registerTool({
      name: tool.name,
      label: tool.name.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
      description: tool.description,
      parameters: toTSchema(tool.input_schema),

      async execute(_toolCallId: string, params: unknown) {
        const result = await callPythonAsync(scriptPath, {
          method: "call",
          tool: toolName,
          args: params,
        });

        return {
          content: [
            {
              type: "text",
              text: typeof result === "string" ? result : JSON.stringify(result),
            },
          ],
          details: {},
        };
      },
    });
  }
}
