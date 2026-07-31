import { createBrowserClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';

/**
 * Browser Supabase client (anon key). Use ONLY in client components.
 * All access is RLS-protected; this client can never bypass RLS.
 */
export function createClient() {
  return createBrowserClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
