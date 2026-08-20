import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { logError } from '@/lib/logger';
import type { RateLimiter } from './types';

/**
 * Postgres-atomic rate limiter (ENGINEERING-19 8.4). Delegates to the SECURITY DEFINER
 * check_rate_limit() RPC, which does a single atomic ON CONFLICT increment. FAILS OPEN on a DB
 * error — availability is preferred over rejecting legitimate traffic during a DB outage (the RPC
 * is a defense-in-depth throttle, not the primary authz control, which is requirePermission + RLS).
 */
export class PostgresRateLimiter implements RateLimiter {
  async check(
    key: string,
    organizationId: string,
    maxRequests: number,
    windowSeconds: number,
  ): Promise<boolean> {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('check_rate_limit', {
      p_key: key,
      p_organization_id: organizationId,
      p_max_requests: maxRequests,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      // Fail open (prefer availability over rate-limiting during a DB outage).
      logError('rate-limit check failed (failing open)', { action: key, originalError: error.message });
      return true;
    }
    return data as boolean;
  }
}
