// ENGINEERING-19 (8.4) — provider-neutral rate-limiter interface. The default implementation is
// Postgres-backed (atomic fixed-window counter); the interface allows a Redis/Upstash swap later
// without touching call sites.

export interface RateLimiter {
  /** Returns true if the request is allowed; false if the rate limit is exceeded. */
  check(
    key: string,
    organizationId: string,
    maxRequests: number,
    windowSeconds: number,
  ): Promise<boolean>;
}

/** Thrown by an action when a sensitive mutation exceeds its per-org window budget. */
export class RateLimitExceededError extends Error {
  readonly code = 'RATE_LIMIT_EXCEEDED' as const;
  constructor(key: string) {
    super(`Rate limit exceeded for operation: ${key}`);
    this.name = 'RateLimitExceededError';
  }
}
