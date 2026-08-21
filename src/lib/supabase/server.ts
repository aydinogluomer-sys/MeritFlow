import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { publicEnv } from '@/lib/env';
import type { Database } from '@/types/database.generated';

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Server Supabase client (anon key + request cookies). Use in Server Components,
 * Server Actions and Route Handlers. It runs AS THE LOGGED-IN USER, so every query
 * is enforced by RLS — this is the default data path for the whole app.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
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
