import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { publicEnv, serverEnv } from '@/lib/env';

/**
 * Service-role (admin) Supabase client — BYPASSES RLS.
 *
 * HARD BOUNDARY (SI-11 / AD1):
 *  - `import 'server-only'` makes any attempt to bundle this into client code a BUILD
 *    ERROR — the service_role key can never reach the browser.
 *  - Reserved for rare, trusted, audited server jobs. It is scaffolded but UNUSED in
 *    this phase; nearly all app access goes through the RLS-enforced server client.
 *  - Never log the key; never expose it via NEXT_PUBLIC_.
 */
export function createAdminClient() {
  const { SUPABASE_SERVICE_ROLE_KEY } = serverEnv();

  return createSupabaseClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
