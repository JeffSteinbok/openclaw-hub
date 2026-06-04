/**
 * Main entry point for the obsidian-indexer service.
 *
 * Reads config from environment variables, starts the indexer,
 * and handles graceful shutdown via SIGTERM/SIGINT.
 */

import { VaultIndexer } from "./indexer.js";
import { log } from "./log.js";

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val?.trim()) {
    log.error(`missing required environment variable: ${name}`);
    process.exit(1);
  }
  return val.trim();
}

async function main(): Promise<void> {
  const vaultRoot = requireEnv("OBSIDIAN_VAULT_ROOT");
  const indexLocation = process.env["OBSIDIAN_INDEX_LOCATION"]?.trim()
    ?? `${process.env["HOME"]}/.openclaw/obsidian-index.db`;

  log.info("obsidian-indexer starting", { vaultRoot, indexLocation });

  const indexer = new VaultIndexer({ vaultRoot, indexLocation });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info(`received ${signal}, shutting down...`);
    await indexer.shutdown();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  await indexer.start();
  log.info("indexer running — watching for changes");
}

main().catch((err) => {
  log.error("fatal error", { error: String(err) });
  process.exit(1);
});

export { VaultIndexer } from "./indexer.js";
export { log } from "./log.js";
