/**
 * tools.ts — the tools octo-mcp offers to outside assistants (OctoDot in ChatGPT).
 *
 * The split follows what each tool can do, because ChatGPT asks the user to
 * confirm any tool that isn't marked read-only:
 *
 *   house_status, calendar   read-only. Fixed questions to the `external`
 *                            agent; no free text from the caller reaches it,
 *                            so a read can't be talked into a change.
 *   control_house            changes the house. The request goes to the
 *                            `external` agent, whose Home Assistant actions
 *                            pass through Hass Guard. ChatGPT confirms first.
 *   send_message             sends a message (iMessage or Discord). No AI
 *                            involved: octo-mcp calls the Gateway's `send`
 *                            directly, and the destination must be one of a
 *                            few names whose channel and target live in a
 *                            private file on the host. ChatGPT confirms first.
 *   ping                     reachability check.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface OctoResult {
  ok: boolean;
  text: string;
}

export interface OctoBackend {
  /** Send a prompt to the `external` agent and return its reply. */
  ask(prompt: string): Promise<OctoResult>;
  /** Send a message to an allowlisted destination (by name). */
  send(destination: string, message: string): Promise<OctoResult>;
  /** Destination names send() accepts, with their channel (for the tool description). */
  destinations: Record<string, string>;
}

export const SERVER_INSTRUCTIONS =
  "Octo is Jeff's personal home assistant. Through these tools you can check the house (lights, doors and garage, " +
  "thermostat, TVs) and Jeff's calendars, change things in the house, and send messages (iMessage or Discord) to " +
  "Jeff, a few family members, and a Discord channel. Octo can't read or send email, browse the web, or reach anyone else. Prefer house_status and calendar " +
  "for questions; use control_house only when Jeff asks for a change.";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const CHANGES_THINGS = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

const CALENDAR_RANGES = ["today", "tomorrow", "this_week", "next_7_days"] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const HOUSE_STATUS_PROMPT =
  "Read-only status check; don't change anything. Report briefly: which rooms have lights on, whether the garage door " +
  "or any other cover is open, the thermostat's mode and setpoint, and any TVs that are on.";

export function calendarPrompt(range: string): string {
  return (
    `Read-only calendar check; don't change anything. List the events on Jeff's calendars for ${range}: time, title, ` +
    "and which calendar. Times in America/Los_Angeles."
  );
}

export function controlPrompt(request: string): string {
  return (
    "Jeff asked, through an outside assistant, for this change in the house. Do it with the guarded Home Assistant " +
    "actions only; if it isn't a change to the house, do nothing and say so.\n\nRequest: " +
    JSON.stringify(request)
  );
}

function asContent(result: OctoResult) {
  return { content: [{ type: "text" as const, text: result.text }], isError: !result.ok };
}

async function guarded(run: () => Promise<OctoResult>) {
  try {
    return asContent(await run());
  } catch (e) {
    return asContent({ ok: false, text: `Couldn't reach Octo: ${e instanceof Error ? e.message : String(e)}` });
  }
}

export function registerTools(server: McpServer, now: () => Date, octo?: OctoBackend): void {
  server.registerTool(
    "ping",
    {
      title: "Ping Octo",
      description: "Check that the Octo MCP server is reachable. Returns pong and the server time.",
      annotations: READ_ONLY,
    },
    async () => ({ content: [{ type: "text", text: `pong ${now().toISOString()}` }] }),
  );
  if (!octo) return;

  server.registerTool(
    "house_status",
    {
      title: "House status",
      description:
        "Current state of Jeff's house: which lights are on, whether the garage door or other covers are open, the " +
        "thermostat, and which TVs are on. Read-only.",
      annotations: READ_ONLY,
    },
    async () => guarded(() => octo.ask(HOUSE_STATUS_PROMPT)),
  );

  server.registerTool(
    "calendar",
    {
      title: "Jeff's calendar",
      description:
        "Events on Jeff's calendars (personal, family, travel and work) for a range: today, tomorrow, this_week, " +
        "next_7_days, or a start/end date. Read-only.",
      inputSchema: {
        range: z.enum(CALENDAR_RANGES).optional().describe("A named range; defaults to today"),
        start: z.string().regex(ISO_DATE).optional().describe("Start date, YYYY-MM-DD (use with end)"),
        end: z.string().regex(ISO_DATE).optional().describe("End date, YYYY-MM-DD, inclusive"),
      },
      annotations: READ_ONLY,
    },
    async ({ range, start, end }) => {
      let label: string = (range ?? "today").replace(/_/g, " ");
      if (start || end) {
        if (!start || !end || start > end) {
          return asContent({ ok: false, text: "Give both start and end (YYYY-MM-DD), with start on or before end." });
        }
        label = `${start} through ${end}`;
      }
      return guarded(() => octo.ask(calendarPrompt(label)));
    },
  );

  server.registerTool(
    "control_house",
    {
      title: "Change something in the house",
      description:
        "Ask Octo to change something in Jeff's house: lights, TVs, fans, the thermostat, covers. Example: 'turn off " +
        "the office light'. Every action is checked by Octo's Home Assistant guard; unusual ones wait for Jeff's " +
        "approval. Returns what Octo did.",
      inputSchema: { request: z.string().min(1).max(500).describe("The change, in plain English") },
      annotations: CHANGES_THINGS,
    },
    async ({ request }) => guarded(() => octo.ask(controlPrompt(request))),
  );

  const names = Object.keys(octo.destinations);
  if (names.length > 0) {
    const label = (name: string) =>
      `${name} (${octo.destinations[name] === "discord" ? "Discord" : "iMessage"})`;
    server.registerTool(
      "send_message",
      {
        title: "Send a message",
        description:
          `Send a message from Octo to one of: ${names.map(label).join(", ")}. Only these destinations exist. ` +
          "Write the message in full; it's sent exactly as given.",
        inputSchema: {
          to: z.enum(names as [string, ...string[]]).describe("Where to send it"),
          message: z.string().min(1).max(1000).describe("The message text"),
        },
        annotations: CHANGES_THINGS,
      },
      async ({ to, message }) => guarded(() => octo.send(to, message)),
    );
  }
}
