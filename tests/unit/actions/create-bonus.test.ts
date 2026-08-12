import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import { createPeriod } from '@/app/actions/bonus/create-period';
import { createPool } from '@/app/actions/bonus/create-pool';

const requirePermissionMock = vi.mocked(requirePermission);
const getActiveOrgMock = vi.mocked(getActiveOrg);
const getUserMock = vi.mocked(getUser);
const createClientMock = vi.mocked(createClient);

const PERIOD_ID = '66666666-6666-4666-8666-666666666666';
const POOL_ID = '77777777-7777-4777-8777-777777777777';

/** from(table).insert().select().single() -> { data, error } */
function mockInsertChain(data: unknown, result: { error: unknown }) {
  const single = vi.fn().mockResolvedValue({ data, error: result.error });
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  const from = vi.fn().mockReturnValue({ insert });
  createClientMock.mockResolvedValue({ from } as never);
  return { from, insert };
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

describe('createPeriod', () => {
  const base = { periodType: 'monthly' as const, startsOn: '2026-07-01', endsOn: '2026-07-31' };

  it('happy path: requires period.manage, inserts into bonus_periods', async () => {
    const { from, insert } = mockInsertChain({ id: PERIOD_ID }, { error: null });
    const res = await createPeriod(base);

    expect(res).toEqual({ ok: true, data: { periodId: PERIOD_ID } });
    expect(requirePermissionMock).toHaveBeenCalledWith('period.manage');
    expect(from).toHaveBeenCalledWith('bonus_periods');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 'o1',
        period_type: 'monthly',
        starts_on: '2026-07-01',
        ends_on: '2026-07-31',
        created_by: 'u1',
      }),
    );
    // status is left to the DB default ('open'); the action must not set a non-open status.
    const payload = insert.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.status).toBeUndefined();
  });

  it('authz fail: no DB call, ok:false', async () => {
    requirePermissionMock.mockRejectedValue(new Error('denied'));
    const { from } = mockInsertChain({ id: PERIOD_ID }, { error: null });
    const res = await createPeriod(base);

    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it('Zod: bad date -> VALIDATION_ERROR, no DB call', async () => {
    const { from } = mockInsertChain({ id: PERIOD_ID }, { error: null });
    const res = await createPeriod({ ...base, startsOn: '07/01/2026' });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('VALIDATION_ERROR');
    expect(from).not.toHaveBeenCalled();
  });

  it('DB error: ok:false with the DB message', async () => {
    mockInsertChain(null, { error: { message: 'X' } });
    const res = await createPeriod(base);
    expect(res).toEqual({ ok: false, error: 'X' });
  });
});

describe('createPool', () => {
  const base = { bonusPeriodId: PERIOD_ID, amountMinor: 10000000, currency: 'TRY' };

  it('happy path: requires pool.create, inserts into bonus_pools', async () => {
    const { from, insert } = mockInsertChain({ id: POOL_ID }, { error: null });
    const res = await createPool(base);

    expect(res).toEqual({ ok: true, data: { poolId: POOL_ID } });
    expect(requirePermissionMock).toHaveBeenCalledWith('pool.create');
    expect(from).toHaveBeenCalledWith('bonus_pools');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 'o1',
        bonus_period_id: PERIOD_ID,
        amount_minor: 10000000,
        currency: 'TRY',
        created_by: 'u1',
      }),
    );
    // status/version_no default in the DB ('draft'/1); the action must not force them.
    const payload = insert.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.status).toBeUndefined();
  });

  it('currency defaults to TRY when omitted (Zod .default)', async () => {
    const { insert } = mockInsertChain({ id: POOL_ID }, { error: null });
    const res = await createPool({ bonusPeriodId: PERIOD_ID, amountMinor: 5000 } as never);

    expect(res.ok).toBe(true);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ currency: 'TRY' }));
  });

  it('authz fail: no DB call, ok:false', async () => {
    requirePermissionMock.mockRejectedValue(new Error('denied'));
    const { from } = mockInsertChain({ id: POOL_ID }, { error: null });
    const res = await createPool(base);

    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it('Zod: negative amount -> VALIDATION_ERROR, no DB call', async () => {
    const { from } = mockInsertChain({ id: POOL_ID }, { error: null });
    const res = await createPool({ ...base, amountMinor: -1 });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('VALIDATION_ERROR');
    expect(from).not.toHaveBeenCalled();
  });

  it('DB error: ok:false with the DB message', async () => {
    mockInsertChain(null, { error: { message: 'X' } });
    const res = await createPool(base);
    expect(res).toEqual({ ok: false, error: 'X' });
  });
});
