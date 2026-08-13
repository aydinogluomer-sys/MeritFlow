import { beforeEach, describe, expect, it, vi } from 'vitest';

// The application fns create `new AdminRepository(await createClient())` internally, so we mock the
// server client (harmless stub) + the AdminRepository class (its methods become spies).
const { grantMock, revokeMock, inviteMock } = vi.hoisted(() => ({
  grantMock: vi.fn(),
  revokeMock: vi.fn(),
  inviteMock: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn().mockResolvedValue({}) }));
vi.mock('@/modules/admin/repository/admin-repository', () => ({
  AdminRepository: vi.fn(() => ({
    grantSupportAccess: grantMock,
    revokeSupportAccess: revokeMock,
    createInvitation: inviteMock,
  })),
}));

import { grantSupportAccess, revokeSupportAccess, inviteMember } from '@/modules/admin';

beforeEach(() => vi.clearAllMocks());

describe('admin module — grantSupportAccess', () => {
  const input = { granteeId: 'g', scope: 's', reason: 'reason', expiresAt: '2026-12-31T23:59:59Z' };
  const ctx = { organizationId: 'o1', userId: 'u1' };

  it('happy path: returns { grantId } from repo.grantSupportAccess', async () => {
    grantMock.mockResolvedValue('g1');
    const res = await grantSupportAccess(input, ctx);

    expect(res).toEqual({ grantId: 'g1' });
    expect(grantMock).toHaveBeenCalledWith(input, ctx);
  });

  it('propagates the repo error', async () => {
    grantMock.mockRejectedValue(new Error('X'));
    await expect(grantSupportAccess(input, ctx)).rejects.toThrow('X');
  });
});

describe('admin module — revokeSupportAccess', () => {
  it('happy path: returns { grantId } from the input', async () => {
    revokeMock.mockResolvedValue(undefined);
    const res = await revokeSupportAccess({ grantId: 'grant1' }, { organizationId: 'o1' });

    expect(res).toEqual({ grantId: 'grant1' });
    expect(revokeMock).toHaveBeenCalledWith({ grantId: 'grant1' }, { organizationId: 'o1' });
  });

  it('propagates the repo error', async () => {
    revokeMock.mockRejectedValue(new Error('Y'));
    await expect(revokeSupportAccess({ grantId: 'grant1' }, { organizationId: 'o1' })).rejects.toThrow('Y');
  });
});

describe('admin module — inviteMember', () => {
  it('happy path: returns { token } from repo.createInvitation', async () => {
    inviteMock.mockResolvedValue('tok');
    const res = await inviteMember({ email: 'a@b.com', role: 'manager' });

    expect(res).toEqual({ token: 'tok' });
    expect(inviteMock).toHaveBeenCalledWith({ email: 'a@b.com', role: 'manager' });
  });
});
