import { beforeEach, describe, expect, it, vi } from 'vitest';

// ENGINEERING-02F characterization guard (test-first). Pins the CURRENT behavior of the admin
// actions BEFORE they are extracted into @/modules/admin, then stays green unchanged after the
// refactor (parity, like payroll.test.ts).
vi.mock('@/lib/auth/rbac', () => ({
  requirePermission: vi.fn(),
  PermissionError: class extends Error {},
}));
vi.mock('@/lib/auth/org', () => ({ getActiveOrg: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { grantSupportAccess } from '@/app/actions/admin/grant-support-access';
import { revokeSupportAccess } from '@/app/actions/admin/revoke-support-access';
import { inviteMember } from '@/app/actions/admin/invite-member';

const requirePermissionMock = vi.mocked(requirePermission);
const getActiveOrgMock = vi.mocked(getActiveOrg);
const getUserMock = vi.mocked(getUser);
const createClientMock = vi.mocked(createClient);

const GRANTEE_ID = '11111111-1111-4111-8111-111111111111';
const GRANT_ID = '22222222-2222-4222-8222-222222222222';
const EXPIRES_AT = '2026-12-31T23:59:59Z';

/** support_access_grants.insert().select().single() -> { data, error } */
function mockInsertSelectSingle(result: { data?: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue({ data: result.data ?? { id: 'g1' }, error: result.error });
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  const from = vi.fn().mockReturnValue({ insert });
  createClientMock.mockResolvedValue({ from } as never);
  return { from, insert };
}

/** update().eq().eq().eq() -> { error } (deepest eq resolves) */
function mockUpdateChain(result: { error: unknown }, eqDepth = 3) {
  const resolving = vi.fn().mockResolvedValue(result);
  let chain: { eq: ReturnType<typeof vi.fn> } = { eq: resolving };
  for (let i = 1; i < eqDepth; i++) {
    const next = chain;
    chain = { eq: vi.fn().mockReturnValue(next) };
  }
  const update = vi.fn().mockReturnValue(chain);
  const from = vi.fn().mockReturnValue({ update });
  createClientMock.mockResolvedValue({ from } as never);
  return { from, update };
}

/** createClient().rpc(name, args) -> { data, error } (user client, not admin) */
function mockRpc(result: { data?: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? 'tok', error: result.error });
  createClientMock.mockResolvedValue({ rpc } as never);
  return { rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockResolvedValue(undefined);
  getActiveOrgMock.mockResolvedValue({
    organization_id: 'o1',
    profile_id: 'p1',
    primary_role: 'hr',
  } as never);
  getUserMock.mockResolvedValue({ id: 'u1' } as never);
});

describe('grantSupportAccess', () => {
  const input = {
    granteeId: GRANTEE_ID,
    scope: 'read-only support',
    reason: 'customer ticket #123',
    expiresAt: EXPIRES_AT,
  };

  it('happy path: inserts an active grant scoped to org + granted_by, returns grantId', async () => {
    const { from, insert } = mockInsertSelectSingle({ data: { id: 'g1' }, error: null });
    const res = await grantSupportAccess(input);

    expect(res).toEqual({ ok: true, data: { grantId: 'g1' } });
    expect(requirePermissionMock).toHaveBeenCalledWith('support.grant');
    expect(from).toHaveBeenCalledWith('support_access_grants');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 'o1',
        grantee_id: GRANTEE_ID,
        scope: 'read-only support',
        reason: 'customer ticket #123',
        granted_by: 'u1',
        expires_at: EXPIRES_AT,
        status: 'active',
      }),
    );
  });

  it('authz fail: no DB call, ok:false', async () => {
    requirePermissionMock.mockRejectedValue(new Error('denied'));
    const { from } = mockInsertSelectSingle({ error: null });
    const res = await grantSupportAccess(input);
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it('DB error: ok:false with the message', async () => {
    mockInsertSelectSingle({ data: null, error: { message: 'X' } });
    const res = await grantSupportAccess(input);
    expect(res).toEqual({ ok: false, error: 'INTERNAL' });
  });
});

describe('revokeSupportAccess', () => {
  const input = { grantId: GRANT_ID };

  it('happy path: updates -> revoked scoped to id+org+active, returns grantId', async () => {
    const { from, update } = mockUpdateChain({ error: null }, 3);
    const res = await revokeSupportAccess(input);

    expect(res).toEqual({ ok: true, data: { grantId: GRANT_ID } });
    expect(requirePermissionMock).toHaveBeenCalledWith('support.grant');
    expect(from).toHaveBeenCalledWith('support_access_grants');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'revoked', revoked_at: expect.any(String) }),
    );
  });

  it('authz fail: no DB call, ok:false', async () => {
    requirePermissionMock.mockRejectedValue(new Error('denied'));
    const { from } = mockUpdateChain({ error: null }, 3);
    const res = await revokeSupportAccess(input);
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it('DB error: ok:false with the message', async () => {
    mockUpdateChain({ error: { message: 'Y' } }, 3);
    const res = await revokeSupportAccess(input);
    expect(res).toEqual({ ok: false, error: 'INTERNAL' });
  });
});

describe('inviteMember', () => {
  const input = { email: 'new.member@example.com', role: 'manager' as const };

  it('happy path: rpc create_invitation via USER client, returns token', async () => {
    const { rpc } = mockRpc({ data: 'invite-token-xyz', error: null });
    const res = await inviteMember(input);

    expect(res).toEqual({ ok: true, data: { token: 'invite-token-xyz' } });
    expect(requirePermissionMock).toHaveBeenCalledWith('user.invite');
    expect(rpc).toHaveBeenCalledWith('create_invitation', {
      p_email: 'new.member@example.com',
      p_role: 'manager',
    });
  });

  it('owner role rejected at the schema boundary: ok:false, no rpc', async () => {
    const { rpc } = mockRpc({ error: null });
    const res = await inviteMember({ email: 'x@example.com', role: 'owner' } as never);
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('DB error: ok:false with the message', async () => {
    mockRpc({ data: null, error: { message: 'Z' } });
    const res = await inviteMember(input);
    expect(res).toEqual({ ok: false, error: 'INTERNAL' });
  });
});
