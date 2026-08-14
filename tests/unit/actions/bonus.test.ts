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
import { runCalculation } from '@/app/actions/bonus/run-calculation';
import { postAccrual } from '@/app/actions/bonus/post-accrual';
import { recalculate } from '@/app/actions/bonus/recalculate';
import { runScan } from '@/app/actions/bonus/run-scan';

const requirePermissionMock = vi.mocked(requirePermission);
const getActiveOrgMock = vi.mocked(getActiveOrg);
const getUserMock = vi.mocked(getUser);
const createAdminClientMock = vi.mocked(createAdminClient);

const PERIOD_ID = '11111111-1111-4111-8111-111111111111';
const POOL_ID = '22222222-2222-4222-8222-222222222222';

/** admin.rpc(name, args) -> { data, error } */
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

describe('runCalculation', () => {
  const input = { periodId: PERIOD_ID, poolId: POOL_ID };

  it('happy path: rpc run_bonus_calculation with p_bonus_pool_id (NOT p_pool_id)', async () => {
    const { rpc } = mockRpc({ data: 'snap1', error: null });
    const res = await runCalculation(input);

    expect(res).toEqual({ ok: true, data: { snapshotId: 'snap1' } });
    expect(requirePermissionMock).toHaveBeenCalledWith('period.manage');
    expect(rpc).toHaveBeenCalledWith(
      'run_bonus_calculation',
      expect.objectContaining({ p_bonus_pool_id: POOL_ID, p_triggered_by: 'u1' }),
    );
    const arg = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(arg).toHaveProperty('p_bonus_pool_id');
    expect(arg).not.toHaveProperty('p_pool_id');
  });

  it('authz fail: no rpc, ok:false', async () => {
    requirePermissionMock.mockRejectedValue(new Error('denied'));
    const { rpc } = mockRpc({ data: 'x', error: null });
    const res = await runCalculation(input);

    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rpc error: ok:false with the message', async () => {
    mockRpc({ error: { message: 'X' } });
    const res = await runCalculation(input);
    expect(res).toEqual({ ok: false, error: 'INTERNAL' });
  });
});

describe('postAccrual', () => {
  const input = { periodId: PERIOD_ID };

  it('happy path: rpc post_bonus_accrual', async () => {
    const { rpc } = mockRpc({ data: 'ok', error: null });
    const res = await postAccrual(input);

    expect(res).toEqual({ ok: true, data: 'ok' });
    expect(requirePermissionMock).toHaveBeenCalledWith('calculation.approve');
    expect(rpc).toHaveBeenCalledWith('post_bonus_accrual', {
      p_organization_id: 'o1',
      p_bonus_period_id: PERIOD_ID,
      p_triggered_by: 'u1',
    });
  });

  it('authz fail: no rpc, ok:false', async () => {
    requirePermissionMock.mockRejectedValue(new Error('denied'));
    const { rpc } = mockRpc({ error: null });
    const res = await postAccrual(input);
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rpc error: ok:false with the message', async () => {
    mockRpc({ error: { message: 'X' } });
    const res = await postAccrual(input);
    expect(res).toEqual({ ok: false, error: 'INTERNAL' });
  });
});

describe('recalculate', () => {
  const input = { periodId: PERIOD_ID };

  it('happy path: rpc recalculate_bonus_after_dispute', async () => {
    const { rpc } = mockRpc({ data: 'ok', error: null });
    const res = await recalculate(input);

    expect(res).toEqual({ ok: true, data: 'ok' });
    expect(requirePermissionMock).toHaveBeenCalledWith('period.manage');
    expect(rpc).toHaveBeenCalledWith('recalculate_bonus_after_dispute', {
      p_organization_id: 'o1',
      p_bonus_period_id: PERIOD_ID,
      p_triggered_by: 'u1',
    });
  });

  it('authz fail: no rpc, ok:false', async () => {
    requirePermissionMock.mockRejectedValue(new Error('denied'));
    const { rpc } = mockRpc({ error: null });
    const res = await recalculate(input);
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rpc error: ok:false with the message', async () => {
    mockRpc({ error: { message: 'X' } });
    const res = await recalculate(input);
    expect(res).toEqual({ ok: false, error: 'INTERNAL' });
  });
});

describe('runScan', () => {
  const input = { periodId: PERIOD_ID };

  it('happy path: rpc run_anti_gaming_scan with NO p_triggered_by', async () => {
    const { rpc } = mockRpc({ data: 3, error: null });
    const res = await runScan(input);

    expect(res).toEqual({ ok: true, data: { flagCount: 3 } });
    expect(requirePermissionMock).toHaveBeenCalledWith('period.manage');
    expect(rpc).toHaveBeenCalledWith(
      'run_anti_gaming_scan',
      expect.objectContaining({ p_organization_id: 'o1' }),
    );
    const arg = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(arg).not.toHaveProperty('p_triggered_by');
    expect(arg).toHaveProperty('p_bonus_period_id', PERIOD_ID);
  });

  it('periodId omitted -> p_bonus_period_id null', async () => {
    const { rpc } = mockRpc({ data: 0, error: null });
    await runScan({});
    const arg = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(arg.p_bonus_period_id).toBeNull();
  });

  it('authz fail: no rpc, ok:false', async () => {
    requirePermissionMock.mockRejectedValue(new Error('denied'));
    const { rpc } = mockRpc({ error: null });
    const res = await runScan(input);
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rpc error: ok:false with the message', async () => {
    mockRpc({ error: { message: 'X' } });
    const res = await runScan(input);
    expect(res).toEqual({ ok: false, error: 'INTERNAL' });
  });
});
