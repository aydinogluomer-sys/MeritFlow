import 'server-only';

import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

/**
 * Current authenticated user, validated server-side via `auth.getUser()`
 * (verifies the JWT against Supabase — client claims are never trusted). AD1.
 */
export async function getUser(): Promise<User | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user ?? null;
}

export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) throw new Error('UNAUTHENTICATED');
  return user;
}
