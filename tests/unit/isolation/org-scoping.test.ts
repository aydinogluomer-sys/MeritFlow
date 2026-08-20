import { beforeEach, describe, expect, it, vi } from 'vitest';

// ENGINEERING-06 Track C. True tenant isolation is enforced by RLS in the DB; this file pins the
// WIRING invariant that feeds it: every action derives organizationId from getActiveOrg() (a
// server-side, DB-backed lookup) and NEVER from the user payload. A regression that hardcoded or
// user-sourced the org would break cross-tenant safety silently — these tests catch that.
vi.mock('@/lib/auth/rbac', () => ({
  requirePermission: vi.fn(),
  PermissionError: class extends Error {},
}));
vi.mock('@/lib/auth/org', () => ({ getActiveOrg: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getUser: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimiter: { check: vi.fn().mockResolvedValue(true) },
  RateLimitExceededError: class RateLimitExceededError extends Error {},
}));

import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { runCalculation } from '@/app/actions/bonus/run-calculation';
import { postAccrual } from '@/app/actions/bonus/post-accrual';
import { exportPayout } from '@/app/actions/payroll/export-payout';
import { runScan } from '@/app/actions/bonus/run-scan';
import { runReconciliationAction } from '@/app/actions/admin/run-reconciliation';

const requirePermissionMock = vi.mocked(requirePermission);
const getActiveOrgMock = vi.mocked(getActiveOrg);
const getUserMock = vi.mocked(getUser);
const createAdminClientMock = vi.mocked(createAdminClient);

const PERIOD = '11111111-1111-4111-8111-111111111111';
const POOL = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT = '33333333-3333-4333-8333-333333333333';

type MockRow = Record<string, unknown>;
function mockAdmin(tables: Record<string, MockRow[]>) {
  return {
    from(tableName: string) {
      const result = { data: tables[tableName] ?? [], error: null };
      const b: Record<string, unknown> = { select: () => b, eq: () => b };
      const p = Promise.resolve(result);
      b.then = p.then.bind(p);
      b.catch = p.catch.bind(p);
      return b;
    },
  } as never;
}

function mockRpcOk(data: unknown = 'ok') {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  createAdminClientMock.mockReturnValue({ rpc } as never);
  return rpc;
}

function setOrg(id: string) {
  getActiveOrgMock.mockResolvedValue({ organization_id: id, profile_id: 'p1', primary_role: 'finance' } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockResolvedValue(undefined);
  getUserMock.mockResolvedValue({ id: 'u1' } as never);
  setOrg('SECURE_ORG');
});

describe('org-scoping — organizationId comes only from getActiveOrg()', () => {
  it('T-C1: runCalculation passes getActiveOrg().organization_id to run_bonus_calculation', async () => {
    const rpc = mockRpcOk('snap1');
    await runCalculation({ periodId: PERIOD, poolId: POOL });
    expect(rpc).toHaveBeenCalledWith('run_bonus_calculation', expect.objectContaining({ p_organization_id: 'SECURE_ORG' }));
  });

  it('T-C2: postAccrual passes getActiveOrg().organization_id to post_bonus_accrual', async () => {
    const rpc = mockRpcOk('ok');
    await postAccrual({ periodId: PERIOD });
    expect(rpc).toHaveBeenCalledWith('post_bonus_accrual', expect.objectContaining({ p_organization_id: 'SECURE_ORG' }));
  });

  it('T-C3: runReconciliationAction reports getActiveOrg().organization_id', async () => {
    createAdminClientMock.mockReturnValue(mockAdmin({}));
    const res = await runReconciliationAction({});
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.organizationId).toBe('SECURE_ORG');
  });

  it('T-C4: exportPayout passes getActiveOrg().organization_id to produce_payout_export', async () => {
    const rpc = mockRpcOk('exp1');
    await exportPayout({ periodId: PERIOD, snapshotId: SNAPSHOT, format: 'csv' });
    expect(rpc).toHaveBeenCalledWith('produce_payout_export', expect.objectContaining({ p_organization_id: 'SECURE_ORG' }));
  });

  it('T-C5: a different org context yields a different p_organization_id (no hardcoded org)', async () => {
    const rpc = mockRpcOk('snap');
    setOrg('ORG_A');
    await runCalculation({ periodId: PERIOD, poolId: POOL });
    setOrg('ORG_B');
    await runCalculation({ periodId: PERIOD, poolId: POOL });
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_organization_id: 'ORG_A' });
    expect(rpc.mock.calls[1]![1]).toMatchObject({ p_organization_id: 'ORG_B' });
  });

  it('T-C6: runScan (anti-gaming) passes getActiveOrg().organization_id to run_anti_gaming_scan', async () => {
    const rpc = mockRpcOk(0);
    await runScan({});
    expect(rpc).toHaveBeenCalledWith('run_anti_gaming_scan', expect.objectContaining({ p_organization_id: 'SECURE_ORG' }));
  });
});
