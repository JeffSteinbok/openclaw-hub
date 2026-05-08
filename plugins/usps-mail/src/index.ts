/**
 * USPS Mail Analyzer — TS-native plugin.
 *
 * Wraps @openclaw/mail-action-usps to expose 6 tools with identical
 * interfaces to the Python usps-mail plugin.
 */

import { Type } from "@sinclair/typebox";
import { processDigest, addRule, removeRule, testRule, listRules, lookup, getStats, loadState } from "./handlers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PluginApi = {
  registerTool: (tool: unknown) => void;
  pluginConfig?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data),
      },
    ],
    details: {},
  };
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {},
};

function createEntry() {
  return {
    id: "usps-mail",
    name: "USPS Mail Analyzer",
    description:
      "Analyze USPS Informed Delivery digest emails: parse, vision-classify, apply rules, write memory, send notifications",
    configSchema,
    register(api: PluginApi) {
      // ---------------------------------------------------------------
      // 1. usps_process_digest
      // ---------------------------------------------------------------
      api.registerTool({
        name: "usps_process_digest",
        label: "USPS Process Digest",
        description:
          "Process a USPS Informed Delivery digest folder and classify each mailpiece.",
        parameters: Type.Object({
          folder: Type.String({
            description:
              "Path to directory containing body.html and image files.",
          }),
          analysis: Type.Optional(
            Type.Array(Type.Record(Type.String(), Type.Unknown()), {
              description:
                "Optional pre-computed analysis. Array of objects, one per image " +
                "(in filename sort order), each with: sender, addressee, description, " +
                "type, importance, mail_class, address_method.",
            }),
          ),
          date: Type.Optional(
            Type.String({
              description:
                "Override delivery date (YYYY-MM-DD). Auto-detected if omitted.",
            }),
          ),
          dry_run: Type.Optional(
            Type.Boolean({
              description:
                "If true, skip sending notifications (print instead).",
            }),
          ),
          vision_backend: Type.Optional(
            Type.Union(
              [
                Type.Literal("auto"),
                Type.Literal("provided"),
                Type.Literal("skip"),
              ],
              {
                description:
                  "'auto' (configured agent, default), 'provided' (use analysis arg), " +
                  "'skip' (parsing only, no vision).",
              },
            ),
          ),
          message_id: Type.Optional(
            Type.String({
              description:
                "Outlook Graph API message ID of this digest. Used for state " +
                "tracking and deduplication across runs.",
            }),
          ),
          workspace_agent: Type.String({
            description:
              "Agent workspace that owns USPS rules, config, analysis history, and workflow state.",
          }),
          memory_agent: Type.Optional(
            Type.String({
              description:
                "Agent workspace that owns long-term mail memory markdown.",
            }),
          ),
          vision_agent: Type.Optional(
            Type.String({
              description:
                "Agent that performs USPS scan-image vision analysis. Required when vision_backend is auto.",
            }),
          ),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          try {
            const result = await processDigest({
              folder: params.folder as string,
              analysis: params.analysis as
                | Array<Record<string, unknown>>
                | undefined,
              date: params.date as string | undefined,
              dryRun: (params.dry_run as boolean) ?? false,
              visionBackend:
                (params.vision_backend as string) ?? "auto",
              messageId: params.message_id as string | undefined,
              workspaceAgent: params.workspace_agent as string,
              memoryAgent: params.memory_agent as string | undefined,
              visionAgent: params.vision_agent as string | undefined,
            });
            return formatResult(result);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return formatResult({ error: msg });
          }
        },
      });

      // ---------------------------------------------------------------
      // 2. usps_lookup
      // ---------------------------------------------------------------
      api.registerTool({
        name: "usps_lookup",
        label: "USPS Lookup",
        description:
          "Search saved USPS mail history by GUID, date, or text.",
        parameters: Type.Object({
          guid: Type.Optional(
            Type.String({
              description:
                "Partial GUID to match (first 8 chars is typical).",
            }),
          ),
          date: Type.Optional(
            Type.String({
              description:
                "Date or partial date to match (YYYY-MM-DD or YYYY-MM).",
            }),
          ),
          search: Type.Optional(
            Type.String({
              description: "Text to search for in any field.",
            }),
          ),
          workspace_agent: Type.String({
            description:
              "Agent workspace that owns USPS rules, config, analysis history, and workflow state.",
          }),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          try {
            const results = lookup({
              guid: params.guid as string | undefined,
              date: params.date as string | undefined,
              search: params.search as string | undefined,
              workspaceAgent: params.workspace_agent as string,
            });
            return formatResult({
              count: results.length,
              results: results.slice(0, 50).map((r) => ({
                date: r.date,
                image: r.filename,
                sender: (r.info.sender as string) ?? "Unknown",
                addressee: (r.info.addressee as string) ?? "Unknown",
                importance: (r.info.importance as string) ?? "unknown",
                description: (r.info.description as string) ?? "",
                guid: ((r.info.guid as string) ?? "").slice(0, 8),
              })),
            });
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return formatResult({ error: msg });
          }
        },
      });

      // ---------------------------------------------------------------
      // 3. usps_update_rule
      // ---------------------------------------------------------------
      api.registerTool({
        name: "usps_update_rule",
        label: "USPS Update Rule",
        description:
          "Add, remove, or test USPS mail classification rules.",
        parameters: Type.Object({
          action: Type.Union(
            [
              Type.Literal("add"),
              Type.Literal("remove"),
              Type.Literal("test"),
            ],
            { description: "What to do." },
          ),
          conditions: Type.Optional(
            Type.Record(Type.String(), Type.String(), {
              description:
                "Rule conditions (for 'add'). Keys like sender_contains, " +
                "addressee_contains, description_not_contains, etc.",
            }),
          ),
          importance: Type.Optional(
            Type.Union(
              [
                Type.Literal("urgent"),
                Type.Literal("high"),
                Type.Literal("medium"),
                Type.Literal("low"),
                Type.Literal("junk"),
                Type.Literal("ad"),
              ],
              { description: "Target importance level (for 'add')." },
            ),
          ),
          comment: Type.Optional(
            Type.String({
              description:
                "Human-readable description of the rule (for 'add').",
            }),
          ),
          index: Type.Optional(
            Type.Integer({
              description: "Rule index to remove (for 'remove').",
            }),
          ),
          comment_match: Type.Optional(
            Type.String({
              description:
                "Remove rule whose comment contains this text (for 'remove').",
            }),
          ),
          mailpiece: Type.Optional(
            Type.Record(Type.String(), Type.Unknown(), {
              description:
                "Mailpiece info dict to test against rules (for 'test').",
            }),
          ),
          workspace_agent: Type.String({
            description:
              "Agent workspace that owns USPS rules, config, analysis history, and workflow state.",
          }),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          try {
            const action = (params.action as string) ?? "add";
            const workspaceAgent = params.workspace_agent as string;

            if (action === "add") {
              const conditions =
                (params.conditions as Record<string, string>) ?? {};
              const importance =
                (params.importance as string) ?? "low";
              const comment = (params.comment as string) ?? "";
              return formatResult(
                addRule(conditions, importance, {
                  comment,
                  workspaceAgent,
                }),
              );
            }

            if (action === "remove") {
              return formatResult(
                removeRule({
                  index: params.index as number | undefined,
                  commentMatch: params.comment_match as string | undefined,
                  workspaceAgent,
                }),
              );
            }

            if (action === "test") {
              const info =
                (params.mailpiece as Record<string, unknown>) ?? {};
              return formatResult(testRule(info, workspaceAgent));
            }

            return formatResult({ error: `Unknown action: ${action}` });
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return formatResult({ error: msg });
          }
        },
      });

      // ---------------------------------------------------------------
      // 4. usps_rules
      // ---------------------------------------------------------------
      api.registerTool({
        name: "usps_rules",
        label: "USPS Rules",
        description:
          "List USPS classification rules or test a sample mailpiece.",
        parameters: Type.Object({
          test_mailpiece: Type.Optional(
            Type.Record(Type.String(), Type.Unknown(), {
              description:
                "Optional mailpiece to test. Provide sender, addressee, etc. " +
                "Returns which rule matches and the resulting importance.",
            }),
          ),
          workspace_agent: Type.String({
            description:
              "Agent workspace that owns USPS rules, config, analysis history, and workflow state.",
          }),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          try {
            const workspaceAgent = params.workspace_agent as string;
            if (params.test_mailpiece) {
              return formatResult(
                testRule(
                  params.test_mailpiece as Record<string, unknown>,
                  workspaceAgent,
                ),
              );
            }
            return formatResult(listRules(workspaceAgent));
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return formatResult({ error: msg });
          }
        },
      });

      // ---------------------------------------------------------------
      // 5. usps_stats
      // ---------------------------------------------------------------
      api.registerTool({
        name: "usps_stats",
        label: "USPS Stats",
        description: "Show summary statistics for processed USPS mail.",
        parameters: Type.Object({
          workspace_agent: Type.String({
            description:
              "Agent workspace that owns USPS rules, config, analysis history, and workflow state.",
          }),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          try {
            return formatResult(
              getStats(params.workspace_agent as string),
            );
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return formatResult({ error: msg });
          }
        },
      });

      // ---------------------------------------------------------------
      // 6. usps_status
      // ---------------------------------------------------------------
      api.registerTool({
        name: "usps_status",
        label: "USPS Status",
        description: "Show the current USPS mail workflow state.",
        parameters: Type.Object({
          workspace_agent: Type.String({
            description:
              "Agent workspace that owns USPS rules, config, analysis history, and workflow state.",
          }),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          try {
            const state = loadState(params.workspace_agent as string);
            return formatResult({
              last_checked_at: state.last_checked_at ?? null,
              last_message_id: state.last_message_id ?? null,
              last_date_processed: state.last_date_processed ?? null,
              processed_count: Array.isArray(state.processed_message_ids)
                ? state.processed_message_ids.length
                : 0,
            });
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return formatResult({ error: msg });
          }
        },
      });
    },
  };
}

export { createEntry };
