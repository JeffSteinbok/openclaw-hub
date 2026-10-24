/**
 * limiter.ts — Per-client auth-failure lockout.
 *
 * After `maxFailures` failed auth attempts within `windowMs`, the client is
 * locked out for `lockoutMs` and gets 429 without its credentials being checked.
 * A successful auth clears the client's failure history.
 */

export interface LimiterOptions {
  maxFailures: number;
  windowMs: number;
  lockoutMs: number;
}

export const DEFAULT_LIMITER: LimiterOptions = {
  maxFailures: 10,
  windowMs: 60_000,
  lockoutMs: 300_000,
};

export class AuthFailureLimiter {
  private failures = new Map<string, number[]>();
  private lockedUntil = new Map<string, number>();

  constructor(
    private readonly options: LimiterOptions = DEFAULT_LIMITER,
    private readonly now: () => number = Date.now,
  ) {}

  /** Milliseconds until the client may retry, or 0 if not locked out. */
  retryAfterMs(client: string): number {
    const until = this.lockedUntil.get(client) ?? 0;
    const remaining = until - this.now();
    if (remaining > 0) return remaining;
    if (until) this.lockedUntil.delete(client);
    return 0;
  }

  recordFailure(client: string): void {
    const now = this.now();
    const recent = (this.failures.get(client) ?? []).filter(
      (t) => now - t < this.options.windowMs,
    );
    recent.push(now);
    if (recent.length >= this.options.maxFailures) {
      this.lockedUntil.set(client, now + this.options.lockoutMs);
      this.failures.delete(client);
    } else {
      this.failures.set(client, recent);
    }
  }

  recordSuccess(client: string): void {
    this.failures.delete(client);
  }
}
