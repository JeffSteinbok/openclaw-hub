/**
 * Comprehensive tests for package_tracking_core (TS port).
 * Faithful port of the Python test suite.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, existsSync, unlinkSync, rmdirSync } from 'node:fs';

// Mock node:os so we can redirect homedir for storage tests
vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>();
  return { ...original, homedir: vi.fn(() => original.homedir()) };
});

// Mock node:https so we can control HTTP requests for Narvar tests
vi.mock('node:https', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:https')>();
  return { ...original, request: vi.fn(original.request) };
});

import {
  detectCarrier,
  getTrackingUrl,
  scanTextForTrackingNumbers,
  isShippingSender,
  extractTrackingFromUrls,
  fetchNarvarTracking,
  addPackage,
  removePackage,
  listPackages,
  getPackage,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// detectCarrier
// ---------------------------------------------------------------------------
describe('detectCarrier', () => {
  it('detects UPS', () => {
    expect(detectCarrier('1Z999AA10123456784')).toBe('UPS');
  });

  it('detects UPS lowercase', () => {
    expect(detectCarrier('1z999aa10123456784')).toBe('UPS');
  });

  it('detects UPS with whitespace', () => {
    expect(detectCarrier('  1Z999AA10123456784  ')).toBe('UPS');
  });

  it('detects Amazon', () => {
    expect(detectCarrier('TBA123456789012US')).toBe('Amazon');
  });

  it('detects FedEx 12-digit', () => {
    expect(detectCarrier('123456789012')).toBe('FedEx');
  });

  it('detects FedEx 15-digit', () => {
    expect(detectCarrier('123456789012345')).toBe('FedEx');
  });

  it('detects FedEx 20-digit', () => {
    expect(detectCarrier('12345678901234567890')).toBe('FedEx');
  });

  it('detects USPS 94-prefix', () => {
    expect(detectCarrier('9400111899223100001234')).toBe('USPS');
  });

  it('detects USPS 92-prefix', () => {
    expect(detectCarrier('9200111899223100001234')).toBe('USPS');
  });

  it('returns null for unknown', () => {
    expect(detectCarrier('NOTAVALIDNUMBER')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(detectCarrier('')).toBeNull();
  });

  it('returns null for short number', () => {
    expect(detectCarrier('12345')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getTrackingUrl
// ---------------------------------------------------------------------------
describe('getTrackingUrl', () => {
  it('returns UPS url', () => {
    const url = getTrackingUrl('1Z999AA10123456784');
    expect(url).toContain('ups.com');
    expect(url).toContain('1Z999AA10123456784');
  });

  it('returns FedEx url', () => {
    const url = getTrackingUrl('123456789012', 'FedEx');
    expect(url).toContain('fedex.com');
    expect(url).toContain('123456789012');
  });

  it('returns USPS url', () => {
    const url = getTrackingUrl('9400111899223100001234');
    expect(url).toContain('usps.com');
  });

  it('returns Amazon url', () => {
    const url = getTrackingUrl('TBA123456789012US');
    expect(url).toContain('amazon.com');
  });

  it('returns null for unknown carrier', () => {
    expect(getTrackingUrl('NOTAVALIDNUMBER')).toBeNull();
  });

  it('auto-detects carrier', () => {
    const url = getTrackingUrl('1Z999AA10123456784');
    expect(url).not.toBeNull();
  });

  it('respects explicit carrier override', () => {
    const url = getTrackingUrl('123456789012', 'FedEx');
    expect(url).toContain('fedex.com');
  });
});

// ---------------------------------------------------------------------------
// scanTextForTrackingNumbers
// ---------------------------------------------------------------------------
describe('scanTextForTrackingNumbers', () => {
  it('returns empty for empty text', () => {
    expect(scanTextForTrackingNumbers('')).toEqual([]);
  });

  it('returns empty for null/undefined text', () => {
    expect(scanTextForTrackingNumbers(null as unknown as string)).toEqual([]);
  });

  it('finds single UPS tracking number', () => {
    const results = scanTextForTrackingNumbers(
      'Your tracking number is 1Z999AA10123456784.',
    );
    expect(results).toHaveLength(1);
    expect(results[0].carrier).toBe('UPS');
    expect(results[0].tracking_number).toBe('1Z999AA10123456784');
    expect(results[0].url).toContain('ups.com');
  });

  it('finds multiple carriers', () => {
    const text = 'UPS: 1Z999AA10123456784, Amazon: TBA123456789012US';
    const results = scanTextForTrackingNumbers(text);
    const carriers = new Set(results.map((r) => r.carrier));
    expect(carriers).toContain('UPS');
    expect(carriers).toContain('Amazon');
  });

  it('returns no duplicates', () => {
    const text = 'Track 1Z999AA10123456784 and again 1Z999AA10123456784';
    const results = scanTextForTrackingNumbers(text);
    const trackingNumbers = results.map((r) => r.tracking_number);
    expect(trackingNumbers.length).toBe(new Set(trackingNumbers).size);
  });

  it('returns empty when no matches', () => {
    expect(scanTextForTrackingNumbers('No tracking info here.')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// isShippingSender
// ---------------------------------------------------------------------------
describe('isShippingSender', () => {
  it('recognizes UPS domain', () => {
    expect(isShippingSender('noreply@ups.com')).toBe(true);
  });

  it('recognizes FedEx domain', () => {
    expect(isShippingSender('tracking@fedex.com')).toBe(true);
  });

  it('recognizes subdomain', () => {
    expect(isShippingSender('noreply@notify.narvar.com')).toBe(true);
  });

  it('recognizes exact email match', () => {
    expect(isShippingSender('noreply@nespresso.com')).toBe(true);
  });

  it('rejects unknown sender', () => {
    expect(isShippingSender('random@example.com')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isShippingSender('')).toBe(false);
  });

  it('rejects null', () => {
    expect(isShippingSender(null as unknown as string)).toBe(false);
  });

  it('is case insensitive (domain)', () => {
    expect(isShippingSender('Noreply@UPS.COM')).toBe(true);
  });

  it('is case insensitive (exact email)', () => {
    expect(isShippingSender('NOREPLY@NESPRESSO.COM')).toBe(true);
  });

  it('rejects wrong user at exact-email domain', () => {
    expect(isShippingSender('other@nespresso.com')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractTrackingFromUrls
// ---------------------------------------------------------------------------
describe('extractTrackingFromUrls', () => {
  it('extracts from UPS url', () => {
    const text = 'https://www.ups.com/track?tracknum=1Z999AA10123456784';
    const results = extractTrackingFromUrls(text);
    expect(results).toHaveLength(1);
    expect(results[0].tracking_number).toBe('1Z999AA10123456784');
    expect(results[0].carrier).toBe('UPS');
  });

  it('extracts from FedEx url', () => {
    const text = 'https://www.fedex.com/fedextrack/?trknbr=123456789012';
    const results = extractTrackingFromUrls(text);
    expect(results).toHaveLength(1);
    expect(results[0].tracking_number).toBe('123456789012');
    expect(results[0].carrier).toBe('FedEx');
  });

  it('extracts from USPS url', () => {
    const text =
      'https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=94001118992231000012';
    const results = extractTrackingFromUrls(text);
    expect(results).toHaveLength(1);
    expect(results[0].carrier).toBe('USPS');
  });

  it('detects carrier from Narvar path', () => {
    const text =
      'https://tracking.narvar.com/tracking/ups?tracking_numbers=1Z999AA10123456784';
    const results = extractTrackingFromUrls(text);
    expect(results).toHaveLength(1);
    expect(results[0].carrier).toBe('UPS');
  });

  it('returns empty for no urls', () => {
    expect(extractTrackingFromUrls('just plain text')).toEqual([]);
  });

  it('returns empty for empty text', () => {
    expect(extractTrackingFromUrls('')).toEqual([]);
  });

  it('returns empty for null text', () => {
    expect(extractTrackingFromUrls(null as unknown as string)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Package storage (add/remove/list/get) — redirect homedir to test dir
// ---------------------------------------------------------------------------
describe('Package storage', () => {
  const testDir = join(__dirname, '__test_storage__');
  const openclawDir = join(testDir, '.openclaw');
  const jsonPath = join(openclawDir, 'package_tracking.json');

  beforeEach(async () => {
    // Point homedir to our test directory
    const os = await import('node:os');
    vi.mocked(os.homedir).mockReturnValue(testDir);

    // Create the directory structure
    mkdirSync(openclawDir, { recursive: true });

    // Remove any leftover storage file
    if (existsSync(jsonPath)) unlinkSync(jsonPath);
  });

  afterEach(() => {
    // Clean up
    if (existsSync(jsonPath)) unlinkSync(jsonPath);
    if (existsSync(openclawDir)) {
      try { rmdirSync(openclawDir); } catch { /* ignore */ }
    }
    if (existsSync(testDir)) {
      try { rmdirSync(testDir); } catch { /* ignore */ }
    }
  });

  it('adds and lists a package', () => {
    const result = addPackage('1Z999AA10123456784', undefined, 'Test');
    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('carrier', 'UPS');
    expect(result).toHaveProperty('label', 'Test');

    const pkgList = listPackages();
    expect(pkgList.count).toBe(1);
  });

  it('auto-detects carrier on add', () => {
    const result = addPackage('1Z999AA10123456784');
    expect(result).toHaveProperty('carrier', 'UPS');
  });

  it('rejects empty tracking number', () => {
    const result = addPackage('');
    expect(result).toHaveProperty('error');
  });

  it('rejects unknown carrier', () => {
    const result = addPackage('INVALIDTRACKING');
    expect(result).toHaveProperty('error');
  });

  it('gets a package', () => {
    addPackage('1Z999AA10123456784');
    const result = getPackage('1Z999AA10123456784');
    expect(result).toHaveProperty('tracking_number', '1Z999AA10123456784');
  });

  it('returns error for missing package', () => {
    const result = getPackage('1Z999AA10123456784');
    expect(result).toHaveProperty('error');
  });

  it('returns error for empty get', () => {
    const result = getPackage('');
    expect(result).toHaveProperty('error');
  });

  it('removes a package', () => {
    addPackage('1Z999AA10123456784');
    const result = removePackage('1Z999AA10123456784');
    expect(result).toHaveProperty('success', true);

    const pkgList = listPackages();
    expect(pkgList.count).toBe(0);
  });

  it('returns error removing nonexistent package', () => {
    const result = removePackage('1Z999AA10123456784');
    expect(result).toHaveProperty('error');
  });

  it('returns error removing empty tracking', () => {
    const result = removePackage('');
    expect(result).toHaveProperty('error');
  });

  it('lists empty storage', () => {
    const pkgList = listPackages();
    expect(pkgList.count).toBe(0);
    expect(pkgList.packages).toEqual([]);
  });

  it('adds multiple packages', () => {
    addPackage('1Z999AA10123456784');
    addPackage('TBA123456789012US');
    const pkgList = listPackages();
    expect(pkgList.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// fetchNarvarTracking
// ---------------------------------------------------------------------------
describe('fetchNarvarTracking', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns tracking from URL fast path', async () => {
    const url =
      'https://tracking.narvar.com/tracking/ups?tracking_numbers=1Z999AA10123456784';
    const results = await fetchNarvarTracking(url);
    expect(results).toHaveLength(1);
    expect(results[0].tracking_number).toBe('1Z999AA10123456784');
  });

  it('falls back to HTTP and parses JSON-LD', async () => {
    const html =
      '<script type="application/ld+json">{"trackingNumber": "1Z999AA10123456784"}</script>';

    const https = await import('node:https');
    vi.mocked(https.request).mockImplementation(
      ((_url: unknown, _opts: unknown, cb: unknown) => {
        const callback = cb as (res: {
          on: (event: string, handler: (data?: unknown) => void) => void;
        }) => void;
        const res = {
          on(event: string, handler: (data?: unknown) => void) {
            if (event === 'data') handler(Buffer.from(html));
            if (event === 'end') handler();
          },
        };
        callback(res);
        return {
          on(_event: string, _handler: unknown) { return this; },
          end() {},
          destroy() {},
        };
      }) as unknown as typeof https.request,
    );

    const url = 'https://tracking.narvar.com/somepage';
    const results = await fetchNarvarTracking(url);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].tracking_number).toBe('1Z999AA10123456784');
  });

  it('returns empty on network error', async () => {
    const https = await import('node:https');
    vi.mocked(https.request).mockImplementation(
      ((_url: unknown, _opts: unknown, _cb: unknown) => {
        const handlers: Record<string, (err?: unknown) => void> = {};
        const req = {
          on(event: string, handler: (err?: unknown) => void) {
            handlers[event] = handler;
            return this;
          },
          end() {
            if (handlers['error']) {
              handlers['error'](new Error('network down'));
            }
          },
          destroy() {},
        };
        return req;
      }) as unknown as typeof https.request,
    );

    const url = 'https://tracking.narvar.com/somepage';
    const results = await fetchNarvarTracking(url);
    expect(results).toEqual([]);
  });
});
