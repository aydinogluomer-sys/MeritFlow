import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/rbac', () => ({
  requirePermission: vi.fn(),
  PermissionError: class extends Error {},
}));
vi.mock('@/lib/auth/org', () => ({ getActiveOrg: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { exportPayout } from '@/app/actions/payroll/export-payout';
import { markPaid } from '@/app/actions/payroll/mark-paid';

const requirePermissionMock = vi.mocked(requirePermission);
const getActiveOrgMock = vi.mocked(getActiveOrg);
const getUserMock = vi.mocked(getUser);
const createAdminClientMock = vi.mocked(createAdminClient);

const PERIOD_ID = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT_ID = '22222222-2222-4222-8222-222222222222';
const EXPORT_ID = '33333333-3333-4333-8333-333333333333';

function mockRpc(result: { data?: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? 'res', error: result.error });
  createAdminClientMock.mockReturnValue({ rpc } as never);
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

describe('exportPayout', () => {
  const input = { periodId: PERIOD_ID, snapshotId: SNAPSHOT_ID, format: 'csv' as const };

  it('happy path: rpc produce_payout_export with p_snapshot_id/p_format/p_actor', async () => {
    const { rpc } = mockRpc({ data: 'exp1', error: null });
    const res = await exportPayout(input);

    expect(res).toEqual({ ok: true, data: { exportId: 'exp1' } });
    expect(requirePermissionMock).toHaveBeenCalledWith('payout.export');
    expect(rpc).toHaveBeenCalledWith(
      'produce_payout_export',
      expect.objectContaining({
        p_snapshot_id: SNAPSHOT_ID,
        p_format: 'csv',
        p_actor: 'u1',
      }),
    );
  });

  it('authz fail: no rpc, ok:false', async () => {
    requirePermissionMock.mockRejectedValue(new Error('denied'));
    const { rpc } = mockRpc({ error: null });
    const res = await exportPayout(input);
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rpc error: ok:false with the message', async () => {
    mockRpc({ error: { message: 'X' } });
    const res = await exportPayout(input);
    expect(res).toEqual({ ok: false, error: 'INTERNAL' });
  });

  it('maps a Postgres SQLSTATE end-to-end: 23505 -> CONFLICT', async () => {
    mockRpc({ error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
    const res = await exportPayout(input);
    expect(res).toEqual({ ok: false, error: 'CONFLICT' });
  });
});

describe('markPaid', () => {
  const input = { periodId: PERIOD_ID, exportId: EXPORT_ID };

  it('happy path: rpc mark_payout_paid with org/period/export/actor', async () => {
    const { rpc } = mockRpc({ data: 'ok', error: null });
    const res = await markPaid(input);

    expect(res).toEqual({ ok: true, data: 'ok' });
    expect(requirePermissionMock).toHaveBeenCalledWith('payout.mark_paid');
    expect(rpc).toHaveBeenCalledWith(
      'mark_payout_paid',
      expect.objectContaining({
        p_organization_id: 'o1',
        p_bonus_period_id: PERIOD_ID,
        p_export_id: EXPORT_ID,
        p_actor: 'u1',
      }),
    );
  });

  it('authz fail: no rpc, ok:false', async () => {
    requirePermissionMock.mockRejectedValue(new Error('denied'));
    const { rpc } = mockRpc({ error: null });
    const res = await markPaid(input);
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rpc error: ok:false with the message', async () => {
    mockRpc({ error: { message: 'X' } });
    const res = await markPaid(input);
    expect(res).toEqual({ ok: false, error: 'INTERNAL' });
  });
});
