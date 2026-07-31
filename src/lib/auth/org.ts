import 'server-only';

import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { getUser } from './session';

export const ACTIVE_ORG_COOKIE = 'meritflow-active-org';

export type Membership = {
  organization_id: string;
  profile_id: string;
  primary_role: string;
};

/** The caller's memberships (RLS lets a user read their own membership rows). */
export async function getMemberships(): Promise<Membership[]> {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from('memberships')
    .select('organization_id, profile_id, primary_role');
  return (data ?? []) as Membership[];
}

/**
 * The active organization for this request (Decision F: single active org via cookie).
 * Falls back to the first membership. NOTE: wiring this into the DB `current_org()`
 * used by RLS is a later (Phase 4) integration step; here it only selects context.
 */
export async function getActiveOrg(): Promise<Membership | null> {
  const memberships = await getMemberships();
  if (memberships.length === 0) return null;

  const cookieStore = await cookies();
  const preferred = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;
  const match = preferred
    ? memberships.find((m) => m.organization_id === preferred)
    : undefined;

  return match ?? memberships[0]!;
}
