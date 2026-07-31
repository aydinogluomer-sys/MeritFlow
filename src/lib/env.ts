import { z } from 'zod';

/**
 * Environment model with a strict PUBLIC vs SERVER split.
 *
 * HARD RULES:
 *  - `SUPABASE_SERVICE_ROLE_KEY` is a SERVER-ONLY secret (SI-11): never prefixed with
 *    NEXT_PUBLIC_, never logged, never shipped to the client bundle. It is validated
 *    lazily via `serverEnv()` so importing this module from a client component does not
 *    require (or expose) it.
 *  - Only `NEXT_PUBLIC_*` values are safe for the browser; they are RLS-protected.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENV: z.string().optional(),
});

/** Public env — safe in the browser (anon key is RLS-protected). */
export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

let _serverEnv: z.infer<typeof serverSchema> | null = null;

/**
 * Server-only env accessor. Throws if the service-role key is missing OR if it was
 * accidentally exposed via a NEXT_PUBLIC_ alias. Call this only from server code.
 */
export function serverEnv(): z.infer<typeof serverSchema> {
  if (process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY must never be exposed as NEXT_PUBLIC_ (SI-11).',
    );
  }
  if (!_serverEnv) {
    _serverEnv = serverSchema.parse({
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      SENTRY_DSN: process.env.SENTRY_DSN,
      SENTRY_ENV: process.env.SENTRY_ENV,
    });
  }
  return _serverEnv;
}
