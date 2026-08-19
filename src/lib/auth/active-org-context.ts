import 'server-only';

import { cookies } from 'next/headers';
import { getUser } from '@/lib/auth/session';
import { getMemberships, ACTIVE_ORG_COOKIE, type Membership } from '@/lib/auth/org';

/**
 * The canonical, DB-validated active-organization context for a request. This is the single
 * source of the `organization_id` that BOTH the application authorization path and the
 * PostgreSQL RLS tenant context (`current_org()`) must agree on (ENGINEERING-14 binding
 * principle).
 */
export type ActiveOrgContext = {
  organizationId: string;
  profileId: string;
  primaryRole: string;
};

function toContext(m: Membership): ActiveOrgContext {
  return {
    organizationId: m.organization_id,
    profileId: m.profile_id,
    primaryRole: m.primary_role,
  };
}

/**
 * Resolve the request's active-org context:
 *   1. No authenticated user            → null.
 *   2. No memberships                    → null.
 *   3. ACTIVE_ORG_COOKIE matches a member→ that membership.
 *   4. No cookie / no match              → first membership (documented fallback for
 *      single-org users and ambiguous multi-org; the DB `current_org()` applies the same
 *      first-active-membership fallback, so app and RLS stay aligned).
 *
 * Never throws — any unexpected error resolves to null (fail-safe; callers gate on null).
 * Does NOT call createTenantClient (that would be circular): membership lookup goes through
 * getMemberships(), which is already scoped to auth.uid() inside org.ts.
 */
export async function getActiveOrgContext(): Promise<ActiveOrgContext | null> {
  try {
    const user = await getUser();
    if (!user) return null;

    const memberships = await getMemberships();
    if (memberships.length === 0) return null;

    const cookieStore = await cookies();
    const preferred = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;
    const match = preferred
      ? memberships.find((m) => m.organization_id === preferred)
      : undefined;

    return toContext(match ?? memberships[0]!);
  } catch {
    return null;
  }
}
