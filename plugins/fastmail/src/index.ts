import { createPythonPlugin } from "@local/openclaw-python-framework";

const configSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    accountId: { type: "string" as const, description: "JMAP account identifier" },
    jmapToken: { type: "string" as const, description: "JMAP API authentication token" },
    fromEmail: { type: "string" as const, description: "Sender email address" },
    fromName: { type: "string" as const, description: "Sender display name" },
    identityId: { type: "string" as const, description: "JMAP identity ID for sending" },
    draftsId: { type: "string" as const, description: "JMAP mailbox ID for drafts" },
    sentId: { type: "string" as const, description: "JMAP mailbox ID for sent mail" },
    caldavUrl: { type: "string" as const, description: "CalDAV server URL" },
    caldavUsername: { type: "string" as const, description: "CalDAV username" },
    caldavPassword: { type: "string" as const, description: "CalDAV password" },
    caldavCalendarPath: { type: "string" as const, description: "CalDAV calendar path" },
  },
};

const plugin = {
  id: "fastmail",
  name: "FastMail tools",
  description: "Send email and manage calendar events in Fastmail",
  configSchema,
  register(api: any) {
    createPythonPlugin(api, { script: new URL("./tools.py", import.meta.url) });
  },
};

export default plugin;
