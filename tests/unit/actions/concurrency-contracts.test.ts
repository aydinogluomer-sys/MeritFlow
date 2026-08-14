import { beforeEach, describe, expect, it, vi } from 'vitest';

// ENGINEERING-06 Track B. True concurrency isn't reproducible in Vitest, so we pin the BEHAVIORAL
// contract instead: when the DB rejects a racing write with a SQLSTATE (unique/check/fk), the
// action surfaces the correct typed code (CONFLICT / CONSTRAINT_VIOLATION) — it never swallows the
// rejection. Each test references the Decision-Lock rule the DB constraint enforces.
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
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runCalculation } from '@/app/actions/bonus/run-calculation';
import { reviewTask } from '@/app/actions/tasks/review-task';
import { exportPayout } from '@/app/actions/payroll/export-payout';
import { postAccrual } from '@/app/actions/bonus/post-accrual';
import { runReconciliationAction } from '@/app/actions/admin/run-reconciliation';

const requirePermissionMock = vi.mocked(requirePermission);
const getActiveOrgMock = vi.mocked(getActiveOrg);
const getUserMock = vi.mocked(getUser);
const createClientMock = vi.mocked(createClient);
const createAdminClientMock = vi.mocked(createAdminClient);

const PERIOD = '11111111-1111-4111-8111-111111111111';
const POOL = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT = '33333333-3333-4333-8333-333333333333';
const TASK = '44444444-4444-4444-8444-444444444444';

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

/** admin.rpc(...) resolving to a SQLSTATE error. */
function mockRpcError(code: string) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { code, message: `pg ${code}` } });
  createAdminClientMock.mockReturnValue({ rpc } as never);
  return rpc;
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockResolvedValue(undefined);
  getActiveOrgMock.mockResolvedValue({ organization_id: 'o1', profile_id: 'p1', primary_role: 'finance' } as never);
  getUserMock.mockResolvedValue({ id: 'u1' } as never);
});

describe('concurrency contracts — SQLSTATE → typed code', () => {
  it('T-B1 · AD10+idempotency: runCalculation with a duplicate idempotency key (23505 unique) → CONFLICT', async () => {
    mockRpcError('23505');
    const res = await runCalculation({ periodId: PERIOD, poolId: POOL });
    expect(res).toEqual({ ok: false, error: 'CONFLICT' });
  });

  it('T-B2 · D3: reviewTask surfaces a DB check-constraint (23514) as CONSTRAINT_VIOLATION — not swallowed', async () => {
    createClientMock.mockResolvedValue({
      from: vi.fn().mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: { code: '23514', message: 'check' } }) }),
    } as never);
    const res = await reviewTask({ taskId: TASK, decision: 'approve', quality: 'good', timeliness: 'on_time' });
    expect(res).toEqual({ ok: false, error: 'CONSTRAINT_VIOLATION' });
  });

  it('T-B3 · AD6: exportPayout when a pending_missing_cap_basis gate fires (23514) → CONSTRAINT_VIOLATION (no export)', async () => {
    mockRpcError('23514');
    const res = await exportPayout({ periodId: PERIOD, snapshotId: SNAPSHOT, format: 'csv' });
    expect(res).toEqual({ ok: false, error: 'CONSTRAINT_VIOLATION' });
  });

  it('T-B4 · AD8: runCalculation pool overrun without top-up (23514) → CONSTRAINT_VIOLATION (no silent pool breach)', async () => {
    mockRpcError('23514');
    const res = await runCalculation({ periodId: PERIOD, poolId: POOL });
    expect(res).toEqual({ ok: false, error: 'CONSTRAINT_VIOLATION' });
  });

  it('T-B5 · D9+idempotency: postAccrual on an already-accrued snapshot (23505 unique) → CONFLICT', async () => {
    requirePermissionMock.mockResolvedValue(undefined);
    mockRpcError('23505');
    const res = await postAccrual({ periodId: PERIOD });
    expect(res).toEqual({ ok: false, error: 'CONFLICT' });
  });

  it('T-B6 · concurrency: runReconciliationAction is read-only — two calls return the same findingCount (idempotent verifier)', async () => {
    createAdminClientMock.mockReturnValue(mockAdmin({}));
    const r1 = await runReconciliationAction({});
    const r2 = await runReconciliationAction({});
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) expect(r1.data.findingCount).toBe(r2.data.findingCount);
  });

  it('T-B7 · AD1: runCalculation touches the DB only after authz — rpc never called on authz failure', async () => {
    requirePermissionMock.mockRejectedValue(new Error('denied'));
    const rpc = vi.fn();
    createAdminClientMock.mockReturnValue({ rpc } as never);
    const res = await runCalculation({ periodId: PERIOD, poolId: POOL });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('T-B8 · AD1: runReconciliationAction reads the DB only after authz — admin.from never called on authz failure', async () => {
    requirePermissionMock.mockRejectedValue(new Error('denied'));
    const fromSpy = vi.fn();
    createAdminClientMock.mockReturnValue({ from: fromSpy } as never);
    const res = await runReconciliationAction({});
    expect(res.ok).toBe(false);
    expect(fromSpy).not.toHaveBeenCalled();
  });
});
