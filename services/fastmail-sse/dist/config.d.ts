/**
 * Constants, environment helpers, and config loading.
 */
export declare const JMAP_API = "https://api.fastmail.com/jmap/api/";
export declare const EVENT_URL = "https://api.fastmail.com/jmap/event/?types=Email,EmailDelivery&closeafter=no&ping=30";
export declare const STATE_FILE: string;
export declare const CONFIG_FILE: string;
export declare const RECONNECT_DELAY = 10;
export declare const EMAIL_PROPS: string[];
export interface AccountConfig {
    label: string;
    [key: string]: unknown;
}
export interface RuntimeConfig {
    accounts: Record<string, AccountConfig>;
    mail_rules?: MailRule[];
    /**
     * Paths to external ESM action plugin modules to load at startup.
     * Each module must export a `register(registry: ActionRegistry)` function.
     * Paths are resolved as-is (use absolute paths or paths relative to the process cwd).
     *
     * @example
     * "action_plugins": ["/home/user/git/octo/services/mail-actions/dist/index.js"]
     */
    action_plugins?: string[];
    [key: string]: unknown;
}
export interface MailRule {
    id: string;
    accounts?: string[];
    match?: Record<string, unknown>;
    actions: Array<string | Record<string, unknown>>;
    continue?: boolean;
    enabled?: boolean;
    [key: string]: unknown;
}
export declare function log(msg: string): void;
export declare function requireEnv(name: string): string;
export declare function getToken(): string;
export declare function loadRuntimeConfig(): RuntimeConfig;
export declare function buildPipelineRules(config: RuntimeConfig): MailRule[];
