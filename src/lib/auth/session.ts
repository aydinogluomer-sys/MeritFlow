import 'server-only';

import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { DomainError, toDomainError } from '@/lib/errors';

/**
 * Current authenticated user, validated server-side via `auth.getUser()`
 * (verifies the JWT against Supabase — client claims are never trusted). AD1.
 *
 * Fails closed: auth service errors throw (ENGINEERING-26) rather than silently returning null,
 * which would open an unauthenticated path on transient outages.
 */
export async function getUser(): Promise<User | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) throw toDomainError(error);
  return data.user ?? null;
}

export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) throw new DomainError('NOT_AUTHENTICATED');
  return user;
}
