'use server';

import { cookies } from 'next/headers';
import { requireUser } from '@/lib/auth/session';
import { getMemberships, ACTIVE_ORG_COOKIE } from '@/lib/auth/org';

// RFC-4122 shape check — a defensive format gate before the DB membership check below.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Set the request's active organization (a cookie preference). The org is validated DB-side
 * against the caller's own memberships BEFORE the cookie is written — a caller can never
 * select an org they are not a member of. This is a UI preference, not a financial mutation,
 * so there is no audit log; there is no redirect (the caller decides what to do next).
 * ENGINEERING-14.
 */
export async function setActiveOrg(orgId: string): Promise<void> {
  await requireUser();

  if (!UUID_RE.test(orgId)) throw new Error('FORBIDDEN');

  const memberships = await getMemberships();
  const isMember = memberships.some((m) => m.organization_id === orgId);
  if (!isMember) throw new Error('FORBIDDEN');

  const store = await cookies();
  store.set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
}
