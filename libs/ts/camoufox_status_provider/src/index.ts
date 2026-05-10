/**
 * Camoufox-based universal carrier status provider.
 *
 * Shells out to a Python scraper that uses Camoufox (a stealth Firefox fork)
 * to load carrier tracking pages and extract status data from the DOM.
 *
 * Supports: USPS, FedEx, UPS.
 *
 * The Python process outputs a JSON envelope to stdout:
 *   { "ok": true,  "result": { ... } }
 *   { "ok": false, "error": { "code": "...", "message": "..." } }
 */

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CarrierStatusPlugin,
  CarrierStatusProvider,
  CarrierStatusResult,
  StatusProviderRegistry,
} from "@openclaw/package-tracking-core";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SUPPORTED_CARRIERS = ["USPS", "FedEx", "UPS"] as const;
const CARRIER_SET = new Set(SUPPORTED_CARRIERS.map((c) => c.toUpperCase()));

/** Max time to wait for the Python subprocess (ms). */
const SUBPROCESS_TIMEOUT_MS = 45_000;

/** Resolve paths once at module load. */
const __dirname = dirname(fileURLToPath(import.meta.url));
const PYTHON_PACKAGE = resolve(__dirname, "..", "python", "camoufox_tracker");
const PYTHON_BIN = process.env.CAMOUFOX_STATUS_PYTHON ?? "python3";

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const TRACKING_RE = /^[A-Za-z0-9 -]{6,40}$/;

function normalizeCarrier(carrier: string): string | null {
  const upper = carrier.toUpperCase();
  if (CARRIER_SET.has(upper)) return upper;

  // Common aliases
  const aliases: Record<string, string> = {
    "FEDERAL EXPRESS": "FEDEX",
    "UNITED PARCEL SERVICE": "UPS",
    "US POSTAL SERVICE": "USPS",
  };
  return aliases[upper] ?? null;
}

// ---------------------------------------------------------------------------
// Subprocess runner
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
        console.error(`[camoufox-provider] stderr: ${stderr.trim()}`);
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
// Provider
// ---------------------------------------------------------------------------

export const camoufoxProvider: CarrierStatusProvider = {
  name: "Camoufox Scraper",
  carriers: [...SUPPORTED_CARRIERS],

  async getStatus(trackingNumber: string, carrier?: string): Promise<CarrierStatusResult | null> {
    const tn = trackingNumber.trim().toUpperCase();

    if (!TRACKING_RE.test(tn)) {
      console.error(`[camoufox-provider] invalid tracking number format: ${tn}`);
      return null;
    }

    const normalizedCarrier = carrier ? normalizeCarrier(carrier) : null;
    if (!normalizedCarrier) {
      console.error(`[camoufox-provider] unsupported carrier: ${carrier}`);
      return null;
    }

    try {
      const envelope = await runPython(normalizedCarrier, tn);

      if (!envelope.ok) {
        const err = envelope.error ?? { code: "UNKNOWN", message: "Unknown error" };
        console.error(`[camoufox-provider] ${err.code}: ${err.message}`);
        return null;
      }

      const r = envelope.result!;
      return {
        tracking_number: (r.tracking_number as string) ?? tn,
        carrier: (r.carrier as string) ?? normalizedCarrier,
        status: (r.status as string) ?? "Unknown",
        delivered: (r.delivered as boolean) ?? false,
        last_update: (r.last_update as string | null) ?? null,
        description: (r.description as string | null) ?? null,
        // Pass through extra fields
        ...(r.events ? { events: r.events } : {}),
        ...(r.expected_delivery ? { expected_delivery: r.expected_delivery } : {}),
        ...(r.service_type ? { service_type: r.service_type } : {}),
      };
    } catch (err) {
      console.error(`[camoufox-provider] subprocess error: ${err}`);
      return null;
    }
  },
};

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

export const register: CarrierStatusPlugin["register"] = (registry: StatusProviderRegistry) => {
  registry.register(camoufoxProvider);
};
