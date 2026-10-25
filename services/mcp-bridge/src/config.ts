/**
 * config.ts — the bridge's tool definitions, loaded from a JSON file.
 *
 * The bridge itself knows nothing about any particular house or person: every
 * tool it offers is declared here. A tool does exactly one of three things:
 *
 *   invoke   call one or more OpenClaw tools directly (tools.invoke, under the
 *            configured agent's tool policy) and condense the results
 *   ask      send a fixed prompt template to an OpenClaw agent and return its
 *            reply; caller values are validated and quoted into the template
 *   send     send a message to one of the named destinations in the private
 *            destinations file (no AI involved)
 *
 * `kind` decides the MCP annotation: "read" tools are marked read-only (clients
 * like ChatGPT run them without asking); "change" tools are not (clients ask the
 * user first). Parameters are deliberately limited to enums, ISO dates and short
 * strings, so read tools can't carry free text into an agent.
 */

import fs from "node:fs";

export type ParamSpec =
  | { type: "enum"; values: string[]; description?: string; optional?: boolean }
  | { type: "date"; description?: string; optional?: boolean }
  | { type: "string"; maxLength?: number; description?: string; optional?: boolean };

export interface InvokeCall {
  tool: string;
  args?: Record<string, unknown>;
  /** Label for this call's results (e.g. the calendar name), passed to the condenser. */
  label?: string;
}

export interface ToolSpec {
  name: string;
  title?: string;
  description: string;
  kind: "read" | "change";
  params?: Record<string, ParamSpec>;
  invoke?: InvokeCall[];
  /** Built-in condenser for invoke results; see condense.ts. Omit to return raw outputs. */
  condense?: string;
  /** Map a `range` enum or `start`/`end` dates onto `after`/`before` args of every call. */
  dateRange?: boolean;
  ask?: { agent?: string; prompt: string };
  send?: boolean;
}

export interface BridgeConfig {
  /** MCP server name shown to clients. */
  name: string;
  /** MCP instructions: what this server is for and what it can't do. */
  instructions?: string;
  /** Agent whose tool policy direct calls run under, and the default for `ask`. */
  agent: string;
  /** IANA timezone for date ranges. */
  timezone?: string;
  /** Entity-id globs the Home Assistant condenser skips (e.g. status LEDs). */
  ignoreEntities?: string[];
  tools: ToolSpec[];
}

export const DATE_RANGES = ["today", "tomorrow", "this_week", "next_7_days"] as const;

export function parseConfig(raw: unknown): BridgeConfig {
  const c = raw as Partial<BridgeConfig>;
  const fail = (msg: string): never => {
    throw new Error(`mcp-bridge config: ${msg}`);
  };
  if (!c || typeof c !== "object") fail("not an object");
  if (typeof c.name !== "string" || !c.name) fail("`name` is required");
  if (typeof c.agent !== "string" || !c.agent) fail("`agent` is required");
  if (!Array.isArray(c.tools) || c.tools.length === 0) fail("`tools` must be a non-empty array");
  const names = new Set<string>();
  for (const t of c.tools!) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(t?.name ?? "")) fail(`bad tool name ${JSON.stringify(t?.name)}`);
    if (names.has(t.name)) fail(`duplicate tool ${t.name}`);
    names.add(t.name);
    if (!t.description) fail(`${t.name}: description is required`);
    if (t.kind !== "read" && t.kind !== "change") fail(`${t.name}: kind must be "read" or "change"`);
    const actions = [t.invoke ? 1 : 0, t.ask ? 1 : 0, t.send ? 1 : 0].reduce((a, b) => a + b, 0);
    if (actions !== 1) fail(`${t.name}: needs exactly one of invoke, ask, send`);
    if (t.invoke && (!Array.isArray(t.invoke) || t.invoke.some((call) => typeof call?.tool !== "string"))) {
      fail(`${t.name}: invoke must be a list of { tool, args? }`);
    }
    if (t.send && t.kind !== "change") fail(`${t.name}: send tools must be kind "change"`);
    if (t.ask && t.kind === "read" && Object.values(t.params ?? {}).some((p) => p.type === "string")) {
      fail(`${t.name}: read tools that ask an agent can't take free-text parameters`);
    }
    for (const [pname, p] of Object.entries(t.params ?? {})) {
      if (!/^[a-z][a-z0-9_]*$/.test(pname)) fail(`${t.name}: bad parameter name ${pname}`);
      if (p.type === "enum" && (!Array.isArray(p.values) || p.values.length === 0)) fail(`${t.name}.${pname}: enum needs values`);
      if (!["enum", "date", "string"].includes(p.type)) fail(`${t.name}.${pname}: unsupported type ${(p as ParamSpec).type}`);
    }
    if (t.ask?.prompt) {
      for (const m of t.ask.prompt.matchAll(/\{([a-z][a-z0-9_]*)\}/g)) {
        if (!t.params?.[m[1]]) fail(`${t.name}: prompt uses {${m[1]}} but no such parameter`);
      }
    }
  }
  return c as BridgeConfig;
}

export function loadConfig(path: string): BridgeConfig {
  return parseConfig(JSON.parse(fs.readFileSync(path, "utf8")));
}
