import { beforeEach, describe, expect, it, vi } from 'vitest';

// ENGINEERING-11 regression: getMemberships must scope to the CALLER's own membership rows.
// The memberships SELECT RLS also exposes the org roster to privileged readers, so without an
// explicit profile_id filter getActiveOrg could pick another member's row — resolving the
// caller to another role's permissions (a privilege-resolution bug surfaced by the E2E suite).
vi.mock('@/lib/auth/session', () => ({ getUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { getUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { getMemberships, getActiveOrg } from '@/lib/auth/org';

const getUserMock = vi.mocked(getUser);
const createClientMock = vi.mocked(createClient);
const cookiesMock = vi.mocked(cookies);

function mockMemberships(rows: Array<Record<string, unknown>>) {
  const eq = vi.fn().mockResolvedValue({ data: rows, error: null });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  createClientMock.mockResolvedValue({ from } as never);
  return { from, select, eq };
}

beforeEach(() => {
  vi.clearAllMocks();
  cookiesMock.mockResolvedValue({ get: () => undefined } as never);
});

describe('getMemberships / getActiveOrg — self-scoped active-org resolution', () => {
  it('filters memberships to the caller (profile_id), not the org roster', async () => {
    getUserMock.mockResolvedValue({ id: 'u1' } as never);
    const { from, eq } = mockMemberships([
      { organization_id: 'o1', profile_id: 'u1', primary_role: 'hr' },
    ]);
    const rows = await getMemberships();
    expect(from).toHaveBeenCalledWith('memberships');
    expect(eq).toHaveBeenCalledWith('profile_id', 'u1');
    expect(rows).toHaveLength(1);
  });

  it('getActiveOrg resolves to the caller own membership role (never another member)', async () => {
    getUserMock.mockResolvedValue({ id: 'u1' } as never);
    mockMemberships([{ organization_id: 'o1', profile_id: 'u1', primary_role: 'hr' }]);
    const org = await getActiveOrg();
    expect(org?.primary_role).toBe('hr');
    expect(org?.profile_id).toBe('u1');
  });

  it('returns [] when unauthenticated', async () => {
    getUserMock.mockResolvedValue(null);
    expect(await getMemberships()).toEqual([]);
  });
});
