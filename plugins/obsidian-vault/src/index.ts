/**
 * Obsidian Vault plugin — OpenClaw plugin shim.
 *
 * Read-only access to an Obsidian vault. Queries the FTS5 index
 * maintained by the obsidian-indexer service.
 */

import { Type } from "@sinclair/typebox";
import { resolve } from "node:path";
import { homedir } from "node:os";
import {
  canonicalizeVaultRoot,
  validateIndexLocation,
  type VaultConfig,
} from "@openclaw/obsidian-core";
import { VaultReader } from "./reader.js";
import {
  handleSearch,
  handleRead,
  handleRecent,
  handleTags,
  handleBacklinks,
  handleRelated,
} from "./handlers.js";

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
    content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data) }],
    details: {},
  };
}

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return resolve(homedir(), p.slice(2));
  }
  return p;
}

function buildConfig(pluginConfig?: Record<string, unknown>): VaultConfig {
  const vaultRoot = ((pluginConfig?.vaultRoot as string) ?? "").trim();
  if (!vaultRoot) {
    throw new Error("obsidian-vault plugin requires 'vaultRoot' configuration");
  }

  const rawIndex = ((pluginConfig?.indexLocation as string) ?? "").trim()
    || "~/.openclaw/obsidian-index.db";

  const canonicalRoot = canonicalizeVaultRoot(expandHome(vaultRoot));
  const indexLocation = resolve(expandHome(rawIndex));

  validateIndexLocation(canonicalRoot, indexLocation);

  return { vaultRoot: canonicalRoot, indexLocation };
}

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    vaultRoot: {
      type: "string" as const,
      description: "Absolute path to the Obsidian vault root directory",
    },
    indexLocation: {
      type: "string" as const,
      description: "Path for the SQLite index database (must be outside vaultRoot)",
      default: "~/.openclaw/obsidian-index.db",
    },
  },
  required: ["vaultRoot"],
};

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

function createEntry() {
  return {
    id: "obsidian-vault",
    name: "Obsidian Vault",
    description: "Read-only access to an Obsidian vault — search, read, and explore notes securely",
    contracts: {
      tools: [
        "vault_search",
        "vault_read",
        "vault_recent",
        "vault_tags",
        "vault_backlinks",
        "vault_related",
      ],
    },
    configSchema,
    register(api: PluginApi) {
      const config = buildConfig(api.pluginConfig);
      const reader = new VaultReader(config.indexLocation);

      // -----------------------------------------------------------------------
      // vault_search
      // -----------------------------------------------------------------------
      api.registerTool({
        name: "vault_search",
        label: "Vault Search",
        description:
          "Full-text search across all notes in the Obsidian vault. Returns ranked results with snippets. " +
          "Uses prefix matching by default (e.g. 'wash' finds 'washer', 'washing'). " +
          "Falls back to substring search if no FTS results found. " +
          "Tip: try multiple related terms with OR (e.g. 'washer OR washing OR laundry').",
        parameters: Type.Object({
          query: Type.String({
            description: "Search query string (FTS5 syntax supported)",
          }),
          limit: Type.Optional(
            Type.Number({
              description: "Maximum number of results (default: 20)",
              default: 20,
              minimum: 1,
              maximum: 100,
            }),
          ),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const query = ((params.query as string) ?? "").trim();
          const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 100);
          return formatResult(handleSearch(reader, query, limit));
        },
      });

      // -----------------------------------------------------------------------
      // vault_read
      // -----------------------------------------------------------------------
      api.registerTool({
        name: "vault_read",
        label: "Vault Read",
        description:
          "Read a single note from the Obsidian vault. Returns parsed content, frontmatter, tags, and wikilinks.",
        parameters: Type.Object({
          path: Type.String({
            description:
              "Relative path to the note within the vault (e.g. 'Projects/Home Assistant/Battery Monitoring.md')",
          }),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const notePath = ((params.path as string) ?? "").trim();
          return formatResult(handleRead(config, notePath));
        },
      });

      // -----------------------------------------------------------------------
      // vault_recent
      // -----------------------------------------------------------------------
      api.registerTool({
        name: "vault_recent",
        label: "Vault Recent Notes",
        description: "List recently modified notes, sorted by modification time.",
        parameters: Type.Object({
          limit: Type.Optional(
            Type.Number({
              description: "Maximum number of results (default: 20)",
              default: 20,
              minimum: 1,
              maximum: 100,
            }),
          ),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 100);
          return formatResult(handleRecent(reader, limit));
        },
      });

      // -----------------------------------------------------------------------
      // vault_tags
      // -----------------------------------------------------------------------
      api.registerTool({
        name: "vault_tags",
        label: "Vault Tags",
        description: "List all tags used across the Obsidian vault.",
        parameters: Type.Object({}),
        async execute(_toolCallId: string, _params: Record<string, unknown>) {
          return formatResult(handleTags(reader));
        },
      });

      // -----------------------------------------------------------------------
      // vault_backlinks
      // -----------------------------------------------------------------------
      api.registerTool({
        name: "vault_backlinks",
        label: "Vault Backlinks",
        description:
          "Find notes that link to a given note using [[wikilinks]].",
        parameters: Type.Object({
          path: Type.String({
            description: "Path of the target note to find backlinks for",
          }),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const notePath = ((params.path as string) ?? "").trim();
          return formatResult(handleBacklinks(reader, notePath));
        },
      });

      // -----------------------------------------------------------------------
      // vault_related
      // -----------------------------------------------------------------------
      api.registerTool({
        name: "vault_related",
        label: "Vault Related Notes",
        description:
          "Find notes related to a given note via wikilinks and shared tags. " +
          "Returns results sorted by relevance with relationship reasons.",
        parameters: Type.Object({
          path: Type.String({
            description: "Path of the note to find related notes for",
          }),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const notePath = ((params.path as string) ?? "").trim();
          return formatResult(handleRelated(reader, notePath));
        },
      });
    },
  };
}

export { createEntry };
