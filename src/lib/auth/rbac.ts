import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { toDomainError } from '@/lib/errors';
import { getActiveOrg } from './org';

/**
 * RBAC read (AD1): permissions are resolved from the DB (`role_permissions` for the
 * active org's `primary_role`) — NEVER from JWT claims. This app-level check is
 * defense-in-depth / UX (nav filtering, early 403). The ultimate enforcement is
 * always server-side RLS in Postgres.
 */
export async function getPermissions(): Promise<string[]> {
  const org = await getActiveOrg();
  if (!org) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('role_permissions')
    .select('permission_key')
    .eq('role_key', org.primary_role);
  if (error) throw toDomainError(error);

  return (data ?? []).map((r) => (r as { permission_key: string }).permission_key);
}

export async function hasPermission(permission: string): Promise<boolean> {
  const perms = await getPermissions();
  return perms.includes(permission);
}

export class PermissionError extends Error {
  constructor(public readonly permission: string) {
    super(`FORBIDDEN: missing permission "${permission}"`);
    this.name = 'PermissionError';
  }
}

/** Throws {@link PermissionError} when the caller lacks the permission. */
export async function requirePermission(permission: string): Promise<void> {
  if (!(await hasPermission(permission))) {
    throw new PermissionError(permission);
  }
}
