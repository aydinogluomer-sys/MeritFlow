import { beforeEach, describe, expect, it, vi } from 'vitest';

// ENGINEERING-15 DoD: run-calculation's idempotency key must be a stable UUID commandId, never the
// old `ui-calc-${periodId}-${Date.now()}` string (which changed every request → retries created
// duplicate calculation runs). We mock the bonus-calculation module to capture the idempotencyKey
// the action passes and assert it is a UUID.

const {
  requirePermissionMock,
  getActiveOrgMock,
  getUserMock,
  createAdminClientMock,
  runCalculationModuleMock,
  logInfoMock,
} = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  getActiveOrgMock: vi.fn(),
  getUserMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  runCalculationModuleMock: vi.fn(),
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
vi.mock('@/modules/bonus-calculation', () => ({
  runCalculation: runCalculationModuleMock,
  BonusCalculationRepository: class {
    constructor(..._args: unknown[]) {}
  },
}));

import { runCalculation } from '@/app/actions/bonus/run-calculation';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIOD = 'a0000000-0000-0000-0000-0000000000c1';
const POOL = 'a0000000-0000-0000-0000-0000000000c2';

let capturedKey: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  capturedKey = undefined;
  requirePermissionMock.mockResolvedValue(undefined);
  getActiveOrgMock.mockResolvedValue({ organization_id: 'a0000000-0000-0000-0000-000000000001' });
  getUserMock.mockResolvedValue({ id: 'u1' });
  createAdminClientMock.mockReturnValue({});
  runCalculationModuleMock.mockImplementation(async (input: { idempotencyKey: string }) => {
    capturedKey = input.idempotencyKey;
    return 'run-id';
  });
});

describe('run-calculation idempotency key', () => {
  it('uses a UUID commandId as the idempotency key (never a Date.now() string)', async () => {
    const res = await runCalculation({ periodId: PERIOD, poolId: POOL });
    expect(res.ok).toBe(true);
    expect(capturedKey).toMatch(UUID_RE);
    expect(capturedKey).not.toContain('ui-calc');
  });

  it('reuses a UI-supplied commandId as the idempotency key (stable across retries)', async () => {
    const cmd = '33333333-3333-3333-3333-333333333333';
    await runCalculation({ periodId: PERIOD, poolId: POOL, commandId: cmd });
    expect(capturedKey).toBe(cmd);
  });
});
