/**
 * Importance rule engine for USPS mail classification.
 *
 * Rules are loaded from a versioned JSON file stored in the mail agent workspace.
 * The plugin ships with no built-in rules — all rules are personal and user-managed.
 *
 * Supported conditions (all case-insensitive):
 *   <field>_contains, <field>_not_contains,
 *   <field>_equals, <field>_not_equals
 *
 * Fields: addressee, sender, description, mail_class, address_method
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import { getRulesFile } from "./paths.js";

export const BADGE_LABELS: Record<string, string> = {
  urgent: "🚨 Urgent",
  high: "⚠️ Important",
  medium: "📬 Medium",
  low: "📭 Low",
  junk: "🗑️ Junk",
  ad: "📢 Ad",
  unknown: "❓ Unknown",
};

export interface Rule {
  importance: string;
  _comment?: string;
  [key: string]: string | undefined;
}

/**
 * Load rules from JSON. Returns [rules_list, version_str].
 */
export function loadRules(options?: {
  rulesPath?: string;
  workspaceAgent?: string;
}): [Rule[], string] {
  const opts = options ?? {};
  if (!opts.rulesPath && !opts.workspaceAgent) {
    throw new Error(
      "workspace_agent is required when rules_path is not provided",
    );
  }
  const path = opts.rulesPath ?? getRulesFile(opts.workspaceAgent);
  if (!existsSync(path)) return [[], "0"];

  const data = JSON.parse(readFileSync(path, "utf-8"));
  if (typeof data === "object" && !Array.isArray(data)) {
    return [data.rules ?? [], String(data.version ?? "0")];
  }
  return [data as Rule[], "0"];
}

/**
 * Atomic write of rules to disk.
 */
export function saveRules(
  rules: Rule[],
  version: string,
  options?: { rulesPath?: string; workspaceAgent?: string },
): void {
  const opts = options ?? {};
  const path = opts.rulesPath ?? getRulesFile(opts.workspaceAgent);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify({ version, rules }, null, 2));
  renameSync(tmp, path);
}

/**
 * Apply importance override rules to a mailpiece info dict.
 * First matching rule wins. Returns a (possibly modified) copy of info.
 */
export function applyRules(
  info: Record<string, unknown>,
  rules?: Rule[],
): Record<string, unknown> {
  if (rules === undefined) {
    const [loaded] = loadRules();
    rules = loaded;
  }
  if (!rules || rules.length === 0) return info;

  const fields: Record<string, string> = {
    addressee: ((info.addressee as string) ?? "").toLowerCase(),
    sender: ((info.sender as string) ?? "").toLowerCase(),
    description: ((info.description as string) ?? "").toLowerCase(),
    mail_class: ((info.mail_class as string) ?? "").toLowerCase(),
    address_method: ((info.address_method as string) ?? "").toLowerCase(),
  };

  for (const rule of rules) {
    let match = true;
    for (const [key, val] of Object.entries(rule)) {
      if (key === "_comment" || key === "importance") continue;
      if (val === undefined) continue;

      const lowerVal = val.toLowerCase();

      if (key.endsWith("_not_contains")) {
        const fieldName = key.slice(0, -"_not_contains".length);
        if ((fields[fieldName] ?? "").includes(lowerVal)) {
          match = false;
        }
      } else if (key.endsWith("_contains")) {
        const fieldName = key.slice(0, -"_contains".length);
        if (!(fields[fieldName] ?? "").includes(lowerVal)) {
          match = false;
        }
      } else if (key.endsWith("_not_equals")) {
        const fieldName = key.slice(0, -"_not_equals".length);
        if (lowerVal === (fields[fieldName] ?? "")) {
          match = false;
        }
      } else if (key.endsWith("_equals")) {
        const fieldName = key.slice(0, -"_equals".length);
        if (lowerVal !== (fields[fieldName] ?? "")) {
          match = false;
        }
      }
    }

    if (match) {
      const copy = { ...info };
      copy.importance = rule.importance;
      return copy;
    }
  }

  return info;
}

/**
 * Add a new rule and bump version. Returns updated rule summary.
 */
export function addRule(
  conditions: Record<string, string>,
  importance: string,
  options?: { comment?: string; workspaceAgent?: string },
): { action: string; rule_index: number; version: string } {
  const opts = options ?? {};
  if (!opts.workspaceAgent) {
    throw new Error("workspace_agent is required");
  }
  const [rules, version] = loadRules({
    workspaceAgent: opts.workspaceAgent,
  });
  const newRule: Rule = { ...conditions, importance };
  if (opts.comment) {
    newRule._comment = opts.comment;
  }

  rules.push(newRule);

  let newVersion: string;
  const parts = version.split(".");
  if (parts.length === 2) {
    newVersion = `${parts[0]}.${parseInt(parts[1], 10) + 1}`;
  } else {
    newVersion = version !== "0" ? `${version}.1` : "1.0";
  }

  saveRules(rules, newVersion, { workspaceAgent: opts.workspaceAgent });
  return { action: "added", rule_index: rules.length - 1, version: newVersion };
}

/**
 * Remove a rule by index or comment substring. Returns result.
 */
export function removeRule(options: {
  index?: number;
  commentMatch?: string;
  workspaceAgent?: string;
}): { action: string; rule?: Rule; version?: string } {
  if (!options.workspaceAgent) {
    throw new Error("workspace_agent is required");
  }
  const [rules, version] = loadRules({
    workspaceAgent: options.workspaceAgent,
  });

  let removed: Rule | undefined;
  if (
    options.index !== undefined &&
    options.index >= 0 &&
    options.index < rules.length
  ) {
    removed = rules.splice(options.index, 1)[0];
  } else if (options.commentMatch) {
    const lowerMatch = options.commentMatch.toLowerCase();
    for (let i = 0; i < rules.length; i++) {
      if ((rules[i]._comment ?? "").toLowerCase().includes(lowerMatch)) {
        removed = rules.splice(i, 1)[0];
        break;
      }
    }
  }

  if (!removed) return { action: "not_found" };

  let newVersion: string;
  const parts = version.split(".");
  if (parts.length === 2) {
    newVersion = `${parts[0]}.${parseInt(parts[1], 10) + 1}`;
  } else {
    newVersion = `${version}.1`;
  }

  saveRules(rules, newVersion, { workspaceAgent: options.workspaceAgent });
  return { action: "removed", rule: removed, version: newVersion };
}

/**
 * Test which rule matches a given mailpiece. Returns match details.
 */
export function testRule(
  info: Record<string, unknown>,
  workspaceAgent?: string,
): {
  original_importance: string;
  final_importance: string;
  rule_matched: boolean;
  rules_version: string;
} {
  if (!workspaceAgent) {
    throw new Error("workspace_agent is required");
  }
  const [rules, version] = loadRules({ workspaceAgent });
  const result = applyRules(info, rules);
  const originalImp = (info.importance as string) ?? "unknown";
  const newImp = (result.importance as string) ?? originalImp;

  return {
    original_importance: originalImp,
    final_importance: newImp,
    rule_matched: originalImp !== newImp,
    rules_version: version,
  };
}

/**
 * List all rules with version.
 */
export function listRules(workspaceAgent?: string): {
  version: string;
  count: number;
  rules: Array<{
    index: number;
    comment: string;
    importance: string;
    conditions: Record<string, string>;
  }>;
} {
  if (!workspaceAgent) {
    throw new Error("workspace_agent is required");
  }
  const [rules, version] = loadRules({ workspaceAgent });
  const summary = rules.map((rule, i) => {
    const conditions: Record<string, string> = {};
    for (const [k, v] of Object.entries(rule)) {
      if (k !== "_comment" && k !== "importance" && v !== undefined) {
        conditions[k] = v;
      }
    }
    return {
      index: i,
      comment: rule._comment ?? "",
      importance: rule.importance ?? "?",
      conditions,
    };
  });
  return { version, count: rules.length, rules: summary };
}
