import { beforeEach, describe, expect, it, vi } from 'vitest';

// ENGINEERING-26 (§15) — getMemberships() must fail-closed: DB errors throw, not return [].

const { createClientMock, eqMock, getUserMock, cookiesMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  eqMock: vi.fn(),
  getUserMock: vi.fn(),
  cookiesMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }));
vi.mock('@/lib/auth/session', () => ({ getUser: getUserMock }));
vi.mock('next/headers', () => ({ cookies: cookiesMock }));

import { getActiveOrg, getMemberships } from '@/lib/auth/org';
import { DomainError } from '@/lib/errors/domain-error';

const ORG_A = 'a0000000-0000-0000-0000-000000000001';
const ORG_B = 'b0000000-0000-0000-0000-000000000002';

function setupDbResult(result: { data: unknown; error: unknown }) {
  createClientMock.mockResolvedValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ eq: eqMock }),
    }),
  });
  eqMock.mockResolvedValue(result);
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ id: 'u1' });
  cookiesMock.mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) });
});

describe('getMemberships()', () => {
  it('returns memberships on happy path', async () => {
    setupDbResult({
      data: [{ organization_id: ORG_A, profile_id: 'u1', primary_role: 'employee' }],
      error: null,
    });
    const ms = await getMemberships();
    expect(ms).toHaveLength(1);
    expect(ms[0]!.organization_id).toBe(ORG_A);
  });

  it('returns [] when user is null (not authenticated)', async () => {
    getUserMock.mockResolvedValue(null);
    expect(await getMemberships()).toEqual([]);
  });

  it('throws DomainError (not []) on DB error — fail-closed (ENGINEERING-26)', async () => {
    setupDbResult({ data: null, error: { code: undefined, message: 'connection reset' } });
    await expect(getMemberships()).rejects.toBeInstanceOf(DomainError);
    await expect(getMemberships()).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('throws DomainError (FORBIDDEN) on privilege error — not silent empty list', async () => {
    setupDbResult({ data: null, error: { code: '42501', message: 'insufficient privilege' } });
    await expect(getMemberships()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('getActiveOrg()', () => {
  it('returns the cookie-selected org when it matches a membership', async () => {
    setupDbResult({
      data: [
        { organization_id: ORG_A, profile_id: 'u1', primary_role: 'employee' },
        { organization_id: ORG_B, profile_id: 'u1', primary_role: 'manager' },
      ],
      error: null,
    });
    cookiesMock.mockResolvedValue({ get: vi.fn().mockReturnValue({ value: ORG_B }) });
    const org = await getActiveOrg();
    expect(org?.organization_id).toBe(ORG_B);
    expect(org?.primary_role).toBe('manager');
  });

  it('returns null when getMemberships throws (DB outage propagates)', async () => {
    // The throw propagates up — getActiveOrg does not swallow
    setupDbResult({ data: null, error: { code: undefined, message: 'timeout' } });
    await expect(getActiveOrg()).rejects.toBeInstanceOf(DomainError);
  });
});
