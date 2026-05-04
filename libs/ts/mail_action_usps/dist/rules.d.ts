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
export declare const BADGE_LABELS: Record<string, string>;
export interface Rule {
    importance: string;
    _comment?: string;
    [key: string]: string | undefined;
}
/**
 * Load rules from JSON. Returns [rules_list, version_str].
 */
export declare function loadRules(options?: {
    rulesPath?: string;
    workspaceAgent?: string;
}): [Rule[], string];
/**
 * Atomic write of rules to disk.
 */
export declare function saveRules(rules: Rule[], version: string, options?: {
    rulesPath?: string;
    workspaceAgent?: string;
}): void;
/**
 * Apply importance override rules to a mailpiece info dict.
 * First matching rule wins. Returns a (possibly modified) copy of info.
 */
export declare function applyRules(info: Record<string, unknown>, rules?: Rule[]): Record<string, unknown>;
/**
 * Add a new rule and bump version. Returns updated rule summary.
 */
export declare function addRule(conditions: Record<string, string>, importance: string, options?: {
    comment?: string;
    workspaceAgent?: string;
}): {
    action: string;
    rule_index: number;
    version: string;
};
/**
 * Remove a rule by index or comment substring. Returns result.
 */
export declare function removeRule(options: {
    index?: number;
    commentMatch?: string;
    workspaceAgent?: string;
}): {
    action: string;
    rule?: Rule;
    version?: string;
};
/**
 * Test which rule matches a given mailpiece. Returns match details.
 */
export declare function testRule(info: Record<string, unknown>, workspaceAgent?: string): {
    original_importance: string;
    final_importance: string;
    rule_matched: boolean;
    rules_version: string;
};
/**
 * List all rules with version.
 */
export declare function listRules(workspaceAgent?: string): {
    version: string;
    count: number;
    rules: Array<{
        index: number;
        comment: string;
        importance: string;
        conditions: Record<string, string>;
    }>;
};
