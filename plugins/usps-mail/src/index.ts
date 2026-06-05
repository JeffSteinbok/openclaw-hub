/**
 * USPS Mail Analyzer — TS-native plugin.
 *
 * Wraps @openclaw/mail-action-usps to expose 6 tools with identical
 * interfaces to the Python usps-mail plugin.
 */

import { definePlugin } from "carapace-plugin-sdk";
import { Type } from "@sinclair/typebox";
import { processDigest, addRule, removeRule, testRule, listRules, lookup, getStats, loadState } from "./handlers.js";

export const createEntry = definePlugin({
  id: "usps-mail",
  name: "USPS Mail Analyzer",
  description:
    "Analyze USPS Informed Delivery digest emails: parse, vision-classify, apply rules, write memory, send notifications",

  configSchema: Type.Object({}),

  tools: (tool) => [
    tool({
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
      async execute({
        folder,
        analysis,
        date,
        dry_run,
        vision_backend,
        message_id,
        workspace_agent,
        memory_agent,
        vision_agent,
      }) {
        try {
          return await processDigest({
            folder,
            analysis,
            date,
            dryRun: dry_run ?? false,
            visionBackend: vision_backend ?? "auto",
            messageId: message_id,
            workspaceAgent: workspace_agent,
            memoryAgent: memory_agent,
            visionAgent: vision_agent,
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return { error: msg };
        }
      },
    }),

    tool({
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
      async execute({ guid, date, search, workspace_agent }) {
        try {
          const results = lookup({
            guid,
            date,
            search,
            workspaceAgent: workspace_agent,
          });
          return {
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
          };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return { error: msg };
        }
      },
    }),

    tool({
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
      async execute({ action, conditions, importance, comment, index, comment_match, mailpiece, workspace_agent }) {
        try {
          if (action === "add") {
            return addRule(conditions ?? {}, importance ?? "low", {
              comment: comment ?? "",
              workspaceAgent: workspace_agent,
            });
          }

          if (action === "remove") {
            return removeRule({
              index,
              commentMatch: comment_match,
              workspaceAgent: workspace_agent,
            });
          }

          if (action === "test") {
            return testRule(mailpiece ?? {}, workspace_agent);
          }

          return { error: `Unknown action: ${action}` };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return { error: msg };
        }
      },
    }),

    tool({
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
      async execute({ test_mailpiece, workspace_agent }) {
        try {
          if (test_mailpiece) {
            return testRule(test_mailpiece, workspace_agent);
          }
          return listRules(workspace_agent);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return { error: msg };
        }
      },
    }),

    tool({
      name: "usps_stats",
      label: "USPS Stats",
      description: "Show summary statistics for processed USPS mail.",
      parameters: Type.Object({
        workspace_agent: Type.String({
          description:
            "Agent workspace that owns USPS rules, config, analysis history, and workflow state.",
        }),
      }),
      async execute({ workspace_agent }) {
        try {
          return getStats(workspace_agent);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return { error: msg };
        }
      },
    }),

    tool({
      name: "usps_status",
      label: "USPS Status",
      description: "Show the current USPS mail workflow state.",
      parameters: Type.Object({
        workspace_agent: Type.String({
          description:
            "Agent workspace that owns USPS rules, config, analysis history, and workflow state.",
        }),
      }),
      async execute({ workspace_agent }) {
        try {
          const state = loadState(workspace_agent);
          return {
            last_checked_at: state.last_checked_at ?? null,
            last_message_id: state.last_message_id ?? null,
            last_date_processed: state.last_date_processed ?? null,
            processed_count: Array.isArray(state.processed_message_ids)
              ? state.processed_message_ids.length
              : 0,
          };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return { error: msg };
        }
      },
    }),
  ],
});
