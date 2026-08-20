import { beforeEach, describe, expect, it, vi } from 'vitest';

// ENGINEERING-15 idempotency: the manual-override action claims a stable commandId in command_log
// BEFORE the append-only mutation. A retry that resends the SAME commandId is absorbed
// (claim_command → false) and returns { alreadyProcessed: true } without re-inserting a ledger row.
//
// CONCURRENT DUPLICATE TEST (ENGINEERING-15 DoD):
// DB-level uniqueness (command_log unique constraint) is the ultimate guard.
// Concurrent duplicate detection is proven by the unique constraint itself —
// only one of two concurrent INSERTs can win; the other gets conflict + do nothing.
// True concurrency test requires a real DB; document here that the constraint
// is the guard, and refer to CI pgTAP (supabase/tests/0039_command_log.test.sql) for the proof.

const {
  requirePermissionMock,
  getActiveOrgMock,
  getUserMock,
  createAdminClientMock,
  manualOverrideModuleMock,
  logInfoMock,
} = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  getActiveOrgMock: vi.fn(),
  getUserMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  manualOverrideModuleMock: vi.fn(),
  logInfoMock: vi.fn(),
}));

vi.mock('@/lib/auth/rbac', () => ({ requirePermission: requirePermissionMock }));
vi.mock('@/lib/auth/org', () => ({ getActiveOrg: getActiveOrgMock }));
vi.mock('@/lib/auth/session', () => ({ getUser: getUserMock }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: createAdminClientMock }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimiter: { check: vi.fn().mockResolvedValue(true) },
  RateLimitExceededError: class RateLimitExceededError extends Error {},
}));
vi.mock('@/lib/logger', () => ({ logInfo: logInfoMock, captureServerError: vi.fn() }));
vi.mock('@/modules/point-ledger', () => ({
  manualOverride: manualOverrideModuleMock,
  PointLedgerRepository: class {
    constructor(..._args: unknown[]) {}
  },
}));

import { manualOverride } from '@/app/actions/points/manual-override';

const ORG = 'a0000000-0000-0000-0000-000000000001';
const CMD_A = '11111111-1111-1111-1111-111111111111';
const CMD_B = '22222222-2222-2222-2222-222222222222';

const baseInput = {
  employeeId: 'e0000000-0000-0000-0000-0000000000e1',
  pointsDelta: 10,
  reason: 'correction',
  secondApproverId: 'f0000000-0000-0000-0000-0000000000f1',
};

// In-memory model of command_log's unique constraint: claim_command returns true the first time a
// (org, op, commandId) triple is seen, false thereafter.
let claimed: Set<string>;

beforeEach(() => {
  vi.clearAllMocks();
  claimed = new Set();
  requirePermissionMock.mockResolvedValue(undefined);
  getActiveOrgMock.mockResolvedValue({ organization_id: ORG });
  getUserMock.mockResolvedValue({ id: 'u1' });
  manualOverrideModuleMock.mockResolvedValue({ ledgerId: 'L1' });
  createAdminClientMock.mockReturnValue({
    rpc: vi.fn(
      async (name: string, params: { p_operation_type: string; p_command_id: string }) => {
        if (name !== 'claim_command') return { data: null, error: null };
        const key = `${ORG}|${params.p_operation_type}|${params.p_command_id}`;
        if (claimed.has(key)) return { data: false, error: null };
        claimed.add(key);
        return { data: true, error: null };
      },
    ),
  });
});

describe('manual-override command idempotency', () => {
  it('first call runs the mutation and returns its result', async () => {
    const res = await manualOverride({ ...baseInput, commandId: CMD_A });
    expect(res).toEqual({ ok: true, data: { ledgerId: 'L1' } });
    expect(manualOverrideModuleMock).toHaveBeenCalledTimes(1);
  });

  it('a retry with the same commandId is idempotent (alreadyProcessed, no re-mutation)', async () => {
    await manualOverride({ ...baseInput, commandId: CMD_A });
    manualOverrideModuleMock.mockClear();

    const retry = await manualOverride({ ...baseInput, commandId: CMD_A });
    expect(retry).toEqual({ ok: true, data: { alreadyProcessed: true } });
    expect(manualOverrideModuleMock).not.toHaveBeenCalled();
  });

  it('a different commandId is an independent operation (runs the mutation)', async () => {
    await manualOverride({ ...baseInput, commandId: CMD_A });
    manualOverrideModuleMock.mockClear();

    const other = await manualOverride({ ...baseInput, commandId: CMD_B });
    expect(other).toEqual({ ok: true, data: { ledgerId: 'L1' } });
    expect(manualOverrideModuleMock).toHaveBeenCalledTimes(1);
  });
});
