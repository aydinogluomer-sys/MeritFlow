import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/org', () => ({ getActiveOrg: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { getActiveOrg, type Membership } from '@/lib/auth/org';
import { createClient } from '@/lib/supabase/server';
import {
  getPermissions,
  hasPermission,
  requirePermission,
  PermissionError,
} from '@/lib/auth/rbac';

const getActiveOrgMock = vi.mocked(getActiveOrg);
const createClientMock = vi.mocked(createClient);

function mockPermissionRows(rows: { permission_key: string }[]) {
  const eq = vi.fn().mockResolvedValue({ data: rows, error: null });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  createClientMock.mockResolvedValue({
    from,
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  return { from, select, eq };
}

const org = (role: string): Membership => ({
  organization_id: 'o1',
  profile_id: 'p1',
  primary_role: role,
});

describe('rbac (AD1 — permissions come from the DB, never JWT claims)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns [] with no active org', async () => {
    getActiveOrgMock.mockResolvedValue(null);
    expect(await getPermissions()).toEqual([]);
  });

  it('reads role_permissions for the active org role', async () => {
    getActiveOrgMock.mockResolvedValue(org('finance'));
    const { from, eq } = mockPermissionRows([{ permission_key: 'payout.export' }]);
    const perms = await getPermissions();
    expect(from).toHaveBeenCalledWith('role_permissions');
    expect(eq).toHaveBeenCalledWith('role_key', 'finance');
    expect(perms).toEqual(['payout.export']);
  });

  it('hasPermission / requirePermission reflect DB permissions', async () => {
    getActiveOrgMock.mockResolvedValue(org('finance'));
    mockPermissionRows([{ permission_key: 'payout.export' }]);
    expect(await hasPermission('payout.export')).toBe(true);
    await expect(requirePermission('payout.export')).resolves.toBeUndefined();
  });

  it('requirePermission throws PermissionError when the permission is missing', async () => {
    getActiveOrgMock.mockResolvedValue(org('employee'));
    mockPermissionRows([{ permission_key: 'task.submit' }]);
    await expect(requirePermission('payout.export')).rejects.toBeInstanceOf(PermissionError);
  });
});
