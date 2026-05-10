/**
 * Built-in carrier status providers for USPS, FedEx, and UPS.
 *
 * Each carrier is registered as an independent provider. Internally they
 * share a Camoufox-based Python scraper, but that's an implementation detail
 * — consumers just see three standard CarrierStatusProviders.
 *
 * The Python subprocess outputs a JSON envelope to stdout:
 *   { "ok": true,  "result": { ... } }
 *   { "ok": false, "error": { "code": "...", "message": "..." } }
 */

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CarrierStatusProvider,
  CarrierStatusResult,
} from "../index.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Max time to wait for the Python subprocess (ms). */
const SUBPROCESS_TIMEOUT_MS = 45_000;

/** Resolve paths once at module load. */
const __dirname = dirname(fileURLToPath(import.meta.url));
const PYTHON_PACKAGE = resolve(__dirname, "..", "..", "python", "camoufox_tracker");
const PYTHON_BIN = process.env.CAMOUFOX_STATUS_PYTHON ?? "python3";

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const TRACKING_RE = /^[A-Za-z0-9 -]{6,40}$/;

/** Carrier name aliases → canonical name. */
const CARRIER_ALIASES: Record<string, string> = {
  "FEDERAL EXPRESS": "FEDEX",
  "UNITED PARCEL SERVICE": "UPS",
  "US POSTAL SERVICE": "USPS",
};

function normalizeCarrier(carrier: string, canonical: string): string | null {
  const upper = carrier.toUpperCase();
  if (upper === canonical) return canonical;
  return CARRIER_ALIASES[upper] === canonical ? canonical : null;
}

// ---------------------------------------------------------------------------
// Subprocess runner (shared by all providers)
// ---------------------------------------------------------------------------

interface PythonEnvelope {
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
}

function runPython(carrier: string, trackingNumber: string): Promise<PythonEnvelope> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(PYTHON_BIN, ["-m", "camoufox_tracker", carrier, trackingNumber], {
      cwd: resolve(PYTHON_PACKAGE, ".."),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: SUBPROCESS_TIMEOUT_MS,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn Python: ${err.message}`));
    });

    child.on("close", (code) => {
      if (stderr.trim()) {
        console.error(`[carrier-provider] stderr: ${stderr.trim()}`);
      }

      if (!stdout.trim()) {
        reject(new Error(`Python exited with code ${code} and no output`));
        return;
      }

      try {
        const envelope: PythonEnvelope = JSON.parse(stdout.trim());
        resolvePromise(envelope);
      } catch {
        reject(new Error(`Invalid JSON from Python: ${stdout.slice(0, 200)}`));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Shared result parser
// ---------------------------------------------------------------------------

function parseResult(envelope: PythonEnvelope, tn: string, carrier: string): CarrierStatusResult | null {
  if (!envelope.ok) {
    const err = envelope.error ?? { code: "UNKNOWN", message: "Unknown error" };
    console.error(`[${carrier.toLowerCase()}-provider] ${err.code}: ${err.message}`);
    return null;
  }

  const r = envelope.result!;
  return {
    tracking_number: (r.tracking_number as string) ?? tn,
    carrier: (r.carrier as string) ?? carrier,
    status: (r.status as string) ?? "Unknown",
    delivered: (r.delivered as boolean) ?? false,
    last_update: (r.last_update as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    ...(r.events ? { events: r.events } : {}),
    ...(r.expected_delivery ? { expected_delivery: r.expected_delivery } : {}),
    ...(r.service_type ? { service_type: r.service_type } : {}),
  };
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

/** Create a provider for a single carrier backed by the Camoufox scraper. */
function makeProvider(displayName: string, canonical: string): CarrierStatusProvider {
  return {
    name: displayName,
    carriers: [canonical],

    async getStatus(trackingNumber: string, carrier?: string): Promise<CarrierStatusResult | null> {
      const tn = trackingNumber.trim().toUpperCase();

      if (!TRACKING_RE.test(tn)) {
        console.error(`[${canonical.toLowerCase()}-provider] invalid tracking number format: ${tn}`);
        return null;
      }

      const resolved = carrier ? normalizeCarrier(carrier, canonical) : null;
      if (!resolved) {
        return null;
      }

      try {
        const envelope = await runPython(canonical, tn);
        return parseResult(envelope, tn, canonical);
      } catch (err) {
        console.error(`[${canonical.toLowerCase()}-provider] subprocess error: ${err}`);
        return null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Built-in providers
// ---------------------------------------------------------------------------

export const uspsProvider = makeProvider("USPS", "USPS");
export const fedexProvider = makeProvider("FedEx", "FEDEX");
export const upsProvider = makeProvider("UPS", "UPS");

/** All built-in Camoufox-backed providers. */
export const builtinProviders: CarrierStatusProvider[] = [
  uspsProvider,
  fedexProvider,
  upsProvider,
];
