/**
 * outlook-webhook — main entry point.
 * HTTP server, Graph subscription lifecycle, mail pipeline.
 */

import http from "node:http";
import { watch, type FSWatcher } from "node:fs";
import { ActionRegistry } from "carapace-mail-runtime";
import { registerBuiltinActions } from "carapace-mail-runtime";
import type { ActionPlugin } from "carapace-mail-runtime";
import {
  log,
  requireEnv,
  loadRuntimeConfig,
  buildPipelineRules,
  CONFIG_FILE,
  WEBHOOK_PORT,
  WEBHOOK_URL,
  SUBSCRIPTION_TTL_MS,
  RENEWAL_THRESHOLD_MS,
  RENEWAL_CHECK_INTERVAL_MS,
} from "./config.js";
import {
  createSubscription,
  renewSubscription,
  deleteSubscription,
  type GraphConfig,
} from "./graph.js";
import { loadState, saveState } from "./state.js";
import {
  handleValidation,
  handleNotification,
  readBody,
} from "./handlers.js";

// ── Subscription lifecycle ────────────────────────────────────

async function ensureSubscription(
  graphConfig: GraphConfig,
  clientState: string,
): Promise<void> {
  const state = loadState();

  // Check if existing subscription is still valid
  if (state.subscriptionId && state.expirationDateTime) {
    const expiresAt = new Date(state.expirationDateTime).getTime();
    const now = Date.now();
    const remaining = expiresAt - now;

    if (remaining > RENEWAL_THRESHOLD_MS) {
      log(
        `subscription ${state.subscriptionId} valid for ${Math.round(remaining / 3600_000)}h — no renewal needed`,
      );
      return;
    }

    if (remaining > 0) {
      // Still alive but needs renewal
      log(`renewing subscription ${state.subscriptionId} (${Math.round(remaining / 3600_000)}h remaining)`);
      try {
        const expiry = new Date(Date.now() + SUBSCRIPTION_TTL_MS).toISOString();
        const updated = await renewSubscription(graphConfig, state.subscriptionId, expiry);
        saveState({
          subscriptionId: updated.id,
          expirationDateTime: updated.expirationDateTime,
        });
        log(`subscription renewed, expires ${updated.expirationDateTime}`);
        return;
      } catch (e) {
        log(`renewal failed, will re-create: ${e}`);
      }
    } else {
      log(`subscription ${state.subscriptionId} has expired, re-creating`);
    }
  }

  // Create new subscription
  const expiry = new Date(Date.now() + SUBSCRIPTION_TTL_MS).toISOString();
  log(`creating Graph subscription → ${WEBHOOK_URL}`);

  const sub = await createSubscription(graphConfig, {
    notificationUrl: WEBHOOK_URL,
    clientState,
    expirationDateTime: expiry,
  });

  saveState({
    subscriptionId: sub.id,
    expirationDateTime: sub.expirationDateTime,
  });
  log(`subscription created: ${sub.id}, expires ${sub.expirationDateTime}`);
}

// ── HTTP server ───────────────────────────────────────────────

function createWebhookServer(opts: {
  graphConfig: GraphConfig;
  clientState: string;
  getPipelineRules: () => ReturnType<typeof buildPipelineRules>;
  registry: ActionRegistry;
  runtimeConfig: Record<string, unknown>;
  notifyChannel: string;
  notifyTarget: string;
}): http.Server {
  return http.createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    const pathname = url.split("?")[0];

    // Log incoming request for debugging
    log(`incoming: ${method} ${url}`);

    // Only handle /outlook/webhook or /
    if (!pathname.startsWith("/outlook/webhook") && pathname !== "/") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    // Graph validation handshake — can be GET or POST with ?validationToken=...
    // Tailscale strips the path prefix, so we check query param on any method first.
    const validated = handleValidation(req, res);
    log(`handleValidation returned: ${validated}`);
    if (validated) return;

    // Graph notification (POST)
    if (method === "POST") {
      // Respond 202 immediately — Graph requires a fast response
      res.writeHead(202);
      res.end();

      // Process asynchronously
      try {
        const body = await readBody(req);
        await handleNotification(body, {
          graphConfig: opts.graphConfig,
          clientState: opts.clientState,
          pipelineRules: opts.getPipelineRules(),
          registry: opts.registry,
          runtimeConfig: opts.runtimeConfig,
          notifyChannel: opts.notifyChannel,
          notifyTarget: opts.notifyTarget,
        });
      } catch (e) {
        log(`error handling notification: ${e}`);
      }
      return;
    }

    res.writeHead(405);
    res.end("Method not allowed");
  });
}

// ── Main ──────────────────────────────────────────────────────

export async function main(): Promise<void> {
  // Required env
  const clientId = requireEnv("OUTLOOK_CLIENT_ID");
  const clientSecret = requireEnv("OUTLOOK_CLIENT_SECRET");
  const refreshToken = requireEnv("OUTLOOK_REFRESH_TOKEN");
  const clientState = requireEnv("OUTLOOK_WEBHOOK_CLIENT_STATE");
  const notifyTarget = requireEnv("NOTIFY_TARGET");
  const notifyChannel = process.env["NOTIFY_CHANNEL"] ?? "discord";

  const graphConfig: GraphConfig = { clientId, clientSecret, refreshToken };

  // Load config + rules
  const runtimeConfig = loadRuntimeConfig();
  const pipelineRules = buildPipelineRules(runtimeConfig);
  const registry = new ActionRegistry();
  registerBuiltinActions(registry, {
    mailboxPrefixResolver: () => "📬",
  });

  // Load external action plugins
  const actionPlugins = (runtimeConfig.action_plugins as string[] | undefined) ?? [];
  for (const pluginPath of actionPlugins) {
    try {
      const mod = (await import(pluginPath)) as ActionPlugin;
      if (typeof mod.register !== "function") {
        log(`WARNING: action plugin ${pluginPath} missing register() — skipping`);
        continue;
      }
      await mod.register(registry);
      log(`loaded action plugin: ${pluginPath}`);
    } catch (e) {
      log(`ERROR: failed to load action plugin ${pluginPath}: ${e}`);
    }
  }

  log(`config: channel=${notifyChannel}, target=${notifyTarget.slice(0, 6)}...`);
  if (pipelineRules.length > 0) {
    log(`compiled ${pipelineRules.length} mail pipeline rule(s)`);
  } else {
    log("no pipeline rules configured — all mail will be processed silently");
  }

  // ── Config file watcher ──────────────────────────────────────
  let configDebounce: ReturnType<typeof setTimeout> | null = null;
  let configWatcher: FSWatcher | undefined;
  try {
    configWatcher = watch(CONFIG_FILE, () => {
      if (configDebounce) clearTimeout(configDebounce);
      configDebounce = setTimeout(() => {
        try {
          const updated = loadRuntimeConfig();
          const newRules = buildPipelineRules(updated);
          pipelineRules.length = 0;
          pipelineRules.push(...newRules);
          log(`config reloaded: ${newRules.length} mail rule(s)`);
        } catch (e) {
          log(`config reload failed (keeping previous rules): ${e}`);
        }
      }, 500);
    });
    log("config watcher active");
  } catch {
    // Config file doesn't exist yet — that's fine
  }

  // ── HTTP server ───────────────────────────────────────────────
  const server = createWebhookServer({
    graphConfig,
    clientState,
    getPipelineRules: () => pipelineRules,
    registry,
    runtimeConfig,
    notifyChannel,
    notifyTarget,
  });

  await new Promise<void>((resolve) => {
    server.listen(WEBHOOK_PORT, "127.0.0.1", () => {
      log(`webhook server listening on 127.0.0.1:${WEBHOOK_PORT}`);
      log(`webhook URL: ${WEBHOOK_URL}`);
      resolve();
    });
  });

  // ── Initial subscription ─────────────────────────────────────
  try {
    await ensureSubscription(graphConfig, clientState);
  } catch (e) {
    log(`ERROR: Could not register Graph subscription: ${e}`);
    log("Continuing — will retry on next renewal check");
  }

  // ── Renewal loop ─────────────────────────────────────────────
  const renewalInterval = setInterval(async () => {
    try {
      await ensureSubscription(graphConfig, clientState);
    } catch (e) {
      log(`renewal check failed: ${e}`);
    }
  }, RENEWAL_CHECK_INTERVAL_MS);

  // ── Graceful shutdown ─────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    log(`${signal} received — shutting down`);
    clearInterval(renewalInterval);
    configWatcher?.close();

    // Try to delete Graph subscription on clean exit
    const state = loadState();
    if (state.subscriptionId) {
      await deleteSubscription(graphConfig, state.subscriptionId);
      saveState({});
    }

    server.close(() => {
      log("server closed");
      process.exit(0);
    });

    // Force exit after 5s
    setTimeout(() => process.exit(0), 5_000).unref();
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main();
