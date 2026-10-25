/**
 * tools.ts — registers the configured tools (config.ts) on an MCP server.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CONDENSERS, type CallResult } from "./condense.js";
import { DATE_RANGES, type BridgeConfig, type ParamSpec, type ToolSpec } from "./config.js";

export interface ToolResult {
  ok: boolean;
  text: string;
}

/** What the tools need from OpenClaw. gateway.ts implements it. */
export interface BridgeBackend {
  /** Call an OpenClaw tool directly under `agent`'s tool policy; returns its structured output. */
  invoke(agent: string, tool: string, args: Record<string, unknown>): Promise<unknown>;
  /** Send a prompt to an agent and return its reply. */
  ask(agent: string, prompt: string): Promise<ToolResult>;
  /** Send a message to a named destination. */
  send(destination: string, message: string): Promise<ToolResult>;
  /** Destination names → channel ("imessage", "discord"), for the send tool's description. */
  destinations: Record<string, string>;
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const CHANGES = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function zodFor(spec: ParamSpec) {
  let schema: z.ZodTypeAny;
  if (spec.type === "enum") schema = z.enum(spec.values as [string, ...string[]]);
  else if (spec.type === "date") schema = z.string().regex(ISO_DATE, "YYYY-MM-DD");
  else schema = z.string().min(1).max(spec.maxLength ?? 500);
  if (spec.description) schema = schema.describe(spec.description);
  return spec.optional ? schema.optional() : schema;
}

function today(timezone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Resolve `range` or `start`/`end` into an inclusive date span, or an error message. */
export function resolveRange(
  params: Record<string, unknown>,
  timezone: string,
  now: Date,
): { after: string; before: string; label: string } | { error: string } {
  const start = params["start"] as string | undefined;
  const end = params["end"] as string | undefined;
  if (start || end) {
    if (!start || !end || start > end) return { error: "Give both start and end (YYYY-MM-DD), with start on or before end." };
    return { after: start, before: end, label: `${start} through ${end}` };
  }
  const range = (params["range"] as (typeof DATE_RANGES)[number] | undefined) ?? "today";
  const t = today(timezone, now);
  switch (range) {
    case "tomorrow":
      return { after: addDays(t, 1), before: addDays(t, 1), label: "tomorrow" };
    case "this_week": {
      const weekday = new Date(`${t}T12:00:00Z`).getUTCDay(); // 0 = Sunday
      return { after: t, before: addDays(t, weekday === 0 ? 0 : 7 - weekday), label: "the rest of this week" };
    }
    case "next_7_days":
      return { after: t, before: addDays(t, 6), label: "the next 7 days" };
    default:
      return { after: t, before: t, label: "today" };
  }
}

/** Fill `{param}` placeholders; caller values are JSON-quoted so they read as data. */
export function fillPrompt(template: string, params: Record<string, unknown>, specs: Record<string, ParamSpec>): string {
  return template.replace(/\{([a-z][a-z0-9_]*)\}/g, (_m, key: string) => {
    const value = params[key];
    if (value === undefined) return "(not given)";
    return specs[key]?.type === "string" ? JSON.stringify(String(value)) : String(value);
  });
}

function text(result: ToolResult) {
  return { content: [{ type: "text" as const, text: result.text }], isError: !result.ok };
}

async function guarded(run: () => Promise<ToolResult>) {
  try {
    return text(await run());
  } catch (e) {
    return text({ ok: false, text: `Couldn't reach OpenClaw: ${e instanceof Error ? e.message : String(e)}` });
  }
}

function runTool(spec: ToolSpec, config: BridgeConfig, backend: BridgeBackend, now: () => Date) {
  const timezone = config.timezone ?? "UTC";
  return async (params: Record<string, unknown>) =>
    guarded(async () => {
      if (spec.send) {
        return backend.send(String(params["to"]), String(params["message"]));
      }
      if (spec.ask) {
        return backend.ask(spec.ask.agent ?? config.agent, fillPrompt(spec.ask.prompt, params, spec.params ?? {}));
      }
      let rangeArgs: Record<string, unknown> = {};
      if (spec.dateRange) {
        const range = resolveRange(params, timezone, now());
        if ("error" in range) return { ok: false, text: range.error };
        rangeArgs = { after: range.after, before: range.before };
      }
      const results: CallResult[] = [];
      for (const call of spec.invoke ?? []) {
        const args = { ...(call.args ?? {}), ...rangeArgs };
        results.push({ tool: call.tool, label: call.label, args, output: await backend.invoke(config.agent, call.tool, args) });
      }
      const condense = spec.condense ? CONDENSERS[spec.condense] : undefined;
      return {
        ok: true,
        text: condense
          ? condense(results, { ignoreEntities: config.ignoreEntities ?? [] })
          : JSON.stringify(results.map((r) => ({ tool: r.tool, label: r.label, output: r.output }))),
      };
    });
}

export function registerTools(server: McpServer, config: BridgeConfig, now: () => Date, backend?: BridgeBackend): void {
  server.registerTool(
    "ping",
    {
      title: "Ping",
      description: "Check that this MCP server is reachable. Returns pong and the server time.",
      annotations: READ_ONLY,
    },
    async () => ({ content: [{ type: "text", text: `pong ${now().toISOString()}` }] }),
  );
  if (!backend) return;

  for (const spec of config.tools) {
    if (spec.condense && !CONDENSERS[spec.condense]) {
      throw new Error(`mcp-bridge config: ${spec.name}: unknown condenser ${spec.condense}`);
    }
    let inputSchema: Record<string, z.ZodTypeAny> = Object.fromEntries(
      Object.entries(spec.params ?? {}).map(([k, p]) => [k, zodFor(p)]),
    );
    let description = spec.description;
    if (spec.dateRange) {
      inputSchema = {
        ...inputSchema,
        range: z.enum(DATE_RANGES).optional().describe("A named range; defaults to today"),
        start: z.string().regex(ISO_DATE).optional().describe("Start date, YYYY-MM-DD (use with end)"),
        end: z.string().regex(ISO_DATE).optional().describe("End date, YYYY-MM-DD, inclusive"),
      };
    }
    if (spec.send) {
      const names = Object.keys(backend.destinations);
      if (names.length === 0) continue; // no destinations configured: don't offer the tool
      const label = (n: string) => `${n} (${backend.destinations[n] === "discord" ? "Discord" : "iMessage"})`;
      description = `${spec.description} Destinations: ${names.map(label).join(", ")}. Only these exist.`;
      inputSchema = {
        to: z.enum(names as [string, ...string[]]).describe("Where to send it"),
        message: z.string().min(1).max(1000).describe("The message text, sent exactly as given"),
      };
    }
    server.registerTool(
      spec.name,
      {
        title: spec.title ?? spec.name,
        description,
        ...(Object.keys(inputSchema).length ? { inputSchema } : {}),
        annotations: spec.kind === "read" ? READ_ONLY : CHANGES,
      },
      runTool(spec, config, backend, now) as never,
    );
  }
}
