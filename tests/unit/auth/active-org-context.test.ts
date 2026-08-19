import { beforeEach, describe, expect, it, vi } from 'vitest';

// ENGINEERING-14 — canonical tenant context. Unit-proves getActiveOrgContext() resolution,
// setActiveOrg() DB-side membership validation, and createTenantClient() header injection
// (the request.headers wiring that current_org() reads). All external deps are mocked; no DB.
const {
  getUserMock,
  requireUserMock,
  getMembershipsMock,
  cookiesMock,
  cookieGetMock,
  cookieSetMock,
  createServerClientMock,
} = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  requireUserMock: vi.fn(),
  getMembershipsMock: vi.fn(),
  cookiesMock: vi.fn(),
  cookieGetMock: vi.fn(),
  cookieSetMock: vi.fn(),
  createServerClientMock: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({
  getUser: getUserMock,
  requireUser: requireUserMock,
}));

vi.mock('@/lib/auth/org', () => ({
  getMemberships: getMembershipsMock,
  ACTIVE_ORG_COOKIE: 'meritflow-active-org',
}));

vi.mock('next/headers', () => ({
  cookies: cookiesMock,
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: createServerClientMock,
}));

import { getActiveOrgContext } from '@/lib/auth/active-org-context';
import { setActiveOrg } from '@/app/actions/organizations/set-active-org';
import { createTenantClient } from '@/lib/supabase/tenant-client';

const ORG_A = 'a0000000-0000-0000-0000-000000000001';
const ORG_B = 'b0000000-0000-0000-0000-000000000002';
const ORG_C = 'c0000000-0000-0000-0000-000000000003';

const mem = (org: string, role = 'employee') => ({
  organization_id: org,
  profile_id: 'u1',
  primary_role: role,
});

beforeEach(() => {
  vi.clearAllMocks();
  cookieGetMock.mockReturnValue(undefined);
  cookiesMock.mockResolvedValue({
    get: cookieGetMock,
    set: cookieSetMock,
    getAll: () => [],
  });
  getUserMock.mockResolvedValue({ id: 'u1' });
  requireUserMock.mockResolvedValue({ id: 'u1' });
  getMembershipsMock.mockResolvedValue([]);
  createServerClientMock.mockReturnValue({});
});

describe('getActiveOrgContext()', () => {
  it('returns null when getUser() is null', async () => {
    getUserMock.mockResolvedValue(null);
    expect(await getActiveOrgContext()).toBeNull();
    expect(getMembershipsMock).not.toHaveBeenCalled();
  });

  it('returns null when there are no memberships', async () => {
    getMembershipsMock.mockResolvedValue([]);
    expect(await getActiveOrgContext()).toBeNull();
  });

  it('returns the cookie-selected org when it is a membership (Org B)', async () => {
    getMembershipsMock.mockResolvedValue([mem(ORG_A), mem(ORG_B, 'admin')]);
    cookieGetMock.mockReturnValue({ value: ORG_B });
    expect(await getActiveOrgContext()).toEqual({
      organizationId: ORG_B,
      profileId: 'u1',
      primaryRole: 'admin',
    });
  });

  it('falls back to the first membership when the cookie org is not a membership', async () => {
    getMembershipsMock.mockResolvedValue([mem(ORG_A), mem(ORG_B)]);
    cookieGetMock.mockReturnValue({ value: ORG_C });
    expect((await getActiveOrgContext())?.organizationId).toBe(ORG_A);
  });

  it('falls back to the first membership when there is no cookie', async () => {
    getMembershipsMock.mockResolvedValue([mem(ORG_A), mem(ORG_B)]);
    cookieGetMock.mockReturnValue(undefined);
    expect((await getActiveOrgContext())?.organizationId).toBe(ORG_A);
  });
});

describe('setActiveOrg()', () => {
  it('sets the cookie on the happy path (org is a membership)', async () => {
    getMembershipsMock.mockResolvedValue([mem(ORG_A), mem(ORG_B)]);
    await expect(setActiveOrg(ORG_B)).resolves.toBeUndefined();
    expect(cookieSetMock).toHaveBeenCalledWith(
      'meritflow-active-org',
      ORG_B,
      { httpOnly: true, sameSite: 'lax', path: '/' },
    );
  });

  it("throws 'FORBIDDEN' when the org is not a membership", async () => {
    getMembershipsMock.mockResolvedValue([mem(ORG_A)]);
    await expect(setActiveOrg(ORG_B)).rejects.toThrow('FORBIDDEN');
    expect(cookieSetMock).not.toHaveBeenCalled();
  });

  it("throws 'FORBIDDEN' when the orgId is not a valid UUID", async () => {
    await expect(setActiveOrg('not-a-uuid')).rejects.toThrow('FORBIDDEN');
    expect(getMembershipsMock).not.toHaveBeenCalled();
    expect(cookieSetMock).not.toHaveBeenCalled();
  });
});

describe('createTenantClient header injection (ENGINEERING-14 DoD)', () => {
  it('passes x-meritflow-org-id to createServerClient global headers', async () => {
    createServerClientMock.mockReturnValue({});

    await createTenantClient('test-org-uuid-1234');

    const opts = createServerClientMock.mock.calls[0]![2];
    expect(opts.global.headers['x-meritflow-org-id']).toBe('test-org-uuid-1234');
  });
});
