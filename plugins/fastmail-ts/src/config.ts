/**
 * FastMail plugin configuration types.
 */

export interface FastmailConfig {
  accountId: string;
  jmapToken: string;
  fromEmail: string;
  fromName: string;
  identityId: string;
  draftsId: string;
  sentId: string;
  caldavUrl: string;
  caldavUsername: string;
  caldavPassword: string;
  caldavCalendarPath: string;
}

export function resolveConfig(pluginConfig: Record<string, unknown> | undefined): FastmailConfig {
  const cfg = pluginConfig ?? {};
  return {
    accountId: (cfg.accountId as string) ?? "",
    jmapToken: (cfg.jmapToken as string) ?? "",
    fromEmail: (cfg.fromEmail as string) ?? "",
    fromName: (cfg.fromName as string) ?? "OpenClaw Assistant",
    identityId: (cfg.identityId as string) ?? "",
    draftsId: (cfg.draftsId as string) ?? "",
    sentId: (cfg.sentId as string) ?? "",
    caldavUrl: (cfg.caldavUrl as string) ?? "",
    caldavUsername: (cfg.caldavUsername as string) ?? "",
    caldavPassword: (cfg.caldavPassword as string) ?? "",
    caldavCalendarPath: (cfg.caldavCalendarPath as string) ?? "",
  };
}
