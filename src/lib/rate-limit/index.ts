// ENGINEERING-19 (8.4) — public API for the sensitive-mutation rate limiter.
export type { RateLimiter } from './types';
export { RateLimitExceededError } from './types';
export { PostgresRateLimiter } from './postgres-rate-limiter';

import type { RateLimiter } from './types';
import { PostgresRateLimiter } from './postgres-rate-limiter';

/** Default singleton — Postgres-backed. Swap the impl here to move to Redis/Upstash later. */
export const rateLimiter: RateLimiter = new PostgresRateLimiter();
