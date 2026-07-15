/**
 * Webhook handlers — validation handshake + notification processing.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ActionRegistry, executeRules } from "carapace-mail-runtime";
import type { MailEnvelope } from "carapace-mail-runtime";
import { log } from "./config.js";
import type { MailRule } from "./config.js";
import { fetchMessage, type GraphConfig, type GraphMessage } from "./graph.js";
import { OutlookProviderClient } from "./provider.js";
import { dispatchResults } from "./dispatch.js";

// ── Types ────────────────────────────────────────────────────

interface GraphNotificationValue {
  subscriptionId?: string;
  clientState?: string;
  changeType?: string;
  resource?: string;
  resourceData?: {
    id?: string;
    "@odata.id"?: string;
    "@odata.type"?: string;
  };
  tenantId?: string;
}

interface GraphNotificationBody {
  value?: GraphNotificationValue[];
}

// ── Envelope conversion ───────────────────────────────────────

function messageToEnvelope(msg: GraphMessage): MailEnvelope {
  const from = msg.from?.emailAddress;
  const senderName = from?.name ?? "";
  const senderEmail = from?.address ?? "unknown";

  // Extract auth headers
  const headers: Record<string, string> = {};
  let authResultsRaw: string | undefined;
  for (const h of msg.internetMessageHeaders ?? []) {
    const key = h.name.toLowerCase();
    if (key === "authentication-results") {
      authResultsRaw = h.value;
      headers[key] = h.value;
    } else if (key === "to" || key === "cc") {
      headers[key] = h.value;
    }
  }

  // Parse auth results
  let authResults: MailEnvelope["auth_results"];
  if (authResultsRaw) {
    const text = authResultsRaw;
    const extract = (proto: string): string | undefined => {
      const m = text.match(
        new RegExp(`(?:^|[;\\n])\\s*${proto}=([a-zA-Z0-9-]+)`, "i"),
      );
      return m ? m[1].toLowerCase() : undefined;
    };
    const dkim = extract("dkim");
    const spf = extract("spf");
    const dmarc = extract("dmarc");
    if (dkim || spf || dmarc) {
      authResults = { dkim, spf, dmarc, raw: text };
    }
  }

  const bodyHtml =
    msg.body?.contentType === "html" ? (msg.body.content ?? null) : null;
  const bodyText =
    msg.body?.contentType === "text"
      ? (msg.body.content ?? null)
      : (msg.bodyPreview ?? null);

  return {
    message_id: msg.id,
    provider: "outlook",
    account_id: "outlook",
    mailbox_id: "inbox",
    sender_name: senderName,
    sender_email: senderEmail,
    subject: (msg.subject ?? "(no subject)").slice(0, 150),
    received_at: msg.receivedDateTime ?? null,
    body_text: bodyText,
    body_html: bodyHtml,
    has_attachments: msg.hasAttachments ?? false,
    auth_results: authResults,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    raw: msg as unknown as Record<string, unknown>,
  };
}

// ── Validation handshake ─────────────────────────────────────

/**
 * Handle Graph webhook validation GET request.
 * Graph sends: GET /webhook?validationToken=<token>
 * We must respond with the token as text/plain within 10 seconds.
 */
export function handleValidation(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const url = new URL(req.url ?? "/", `http://localhost`);
  const token = url.searchParams.get("validationToken");
  if (token) {
    log(`validation handshake: ${token.slice(0, 20)}...`);
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(token);
    return true;
  }
  return false;
}

// ── Notification handler ──────────────────────────────────────

const PIPELINE_WORKSPACE = join(
  homedir(),
  ".openclaw/services/mail-runtime",
);

export async function handleNotification(
  body: string,
  opts: {
    graphConfig: GraphConfig;
    clientState: string;
    pipelineRules: MailRule[];
    registry: ActionRegistry;
    runtimeConfig: Record<string, unknown>;
    notifyChannel: string;
    notifyTarget: string;
  },
): Promise<void> {
  let parsed: GraphNotificationBody;
  try {
    parsed = JSON.parse(body) as GraphNotificationBody;
  } catch {
    log("error: invalid JSON in notification body");
    return;
  }

  const notifications = parsed.value ?? [];
  if (notifications.length === 0) {
    log("received empty notification batch");
    return;
  }

  mkdirSync(PIPELINE_WORKSPACE, { recursive: true });

  for (const notification of notifications) {
    // Validate clientState
    if (notification.clientState !== opts.clientState) {
      log(
        `warning: clientState mismatch — expected ${opts.clientState.slice(0, 8)}... got ${(notification.clientState ?? "").slice(0, 8)}...`,
      );
      continue;
    }

    const messageId = notification.resourceData?.id;
    if (!messageId) {
      log("warning: notification missing resourceData.id, skipping");
      continue;
    }

    log(`processing message ${messageId}`);

    let msg: GraphMessage;
    try {
      msg = await fetchMessage(opts.graphConfig, messageId);
    } catch (e) {
      log(`error fetching message ${messageId}: ${e}`);
      continue;
    }

    const envelope = messageToEnvelope(msg);
    log(`received: "${envelope.subject}" from ${envelope.sender_email}`);

    const providerClient = new OutlookProviderClient(
      opts.graphConfig,
      log,
    );

    try {
      const [, results] = await executeRules(
        envelope,
        opts.pipelineRules as Record<string, unknown>[],
        opts.registry,
        providerClient,
        {
          workspace: PIPELINE_WORKSPACE,
          logger: log,
          config: opts.runtimeConfig,
        },
      );

      dispatchResults(results, {
        channel: opts.notifyChannel,
        target: opts.notifyTarget,
      });
    } catch (e) {
      log(`error processing rules for ${messageId}: ${e}`);
    }
  }
}

// ── HTTP request body reader ──────────────────────────────────

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString();
      if (data.length > 1_000_000) {
        req.destroy();
        reject(new Error("request body too large"));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
