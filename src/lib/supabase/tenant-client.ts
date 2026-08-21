import 'server-only';

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { publicEnv } from '@/lib/env';
import { getActiveOrgContext } from '@/lib/auth/active-org-context';
import type { Database } from '@/types/database.generated';

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * A server Supabase client that pins the PostgreSQL RLS tenant context to `organizationId`
 * by sending the `x-meritflow-org-id` request header. PostgREST exposes it via the
 * `request.headers` GUC, which `current_org()` reads and RE-VALIDATES against the caller's
 * memberships (ENGINEERING-14) — the header is advisory, never the authorization source.
 *
 * Identical to `createClient()` in server.ts (anon key + request cookies, RLS as the
 * logged-in user) except for the added global header.
 */
export async function createTenantClient(organizationId: string) {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      global: {
        headers: { 'x-meritflow-org-id': organizationId },
      },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set({ name, value, ...options });
            });
          } catch {
            // `setAll` from a Server Component is a no-op; the middleware refreshes
            // the session cookie on each request instead.
          }
        },
      },
    },
  );
}

/**
 * Convenience: a tenant client pinned to the request's DB-validated active org. Throws
 * 'NOT_AUTHENTICATED' when there is no active-org context (no user / no memberships).
 */
export async function createTenantClientForActiveOrg() {
  const ctx = await getActiveOrgContext();
  if (!ctx) throw new Error('NOT_AUTHENTICATED');
  return createTenantClient(ctx.organizationId);
}
