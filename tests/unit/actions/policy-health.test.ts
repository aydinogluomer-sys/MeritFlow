import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── mocks ──────────────────────────────────────────────────────────────────────
vi.mock('@/lib/auth/rbac', () => ({
  requirePermission: vi.fn(),
  PermissionError: class PermissionError extends Error {},
}));
vi.mock('@/lib/auth/org', () => ({ getActiveOrg: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getUser: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({ admin: true })) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ rls: true })) }));

// The module is mocked: spy the delegated fns. The app schemas are validated separately below against
// the REAL source (not this mock).
vi.mock('@/modules/incentive-health', () => ({
  evaluatePolicyHealth: vi.fn(),
  acceptHealthRisk: vi.fn(),
}));

import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { evaluatePolicyHealth, acceptHealthRisk } from '@/modules/incentive-health';
import { evaluatePolicyHealthAction } from '@/app/actions/policy-health/evaluate-health';
import { acceptHealthRiskAction } from '@/app/actions/policy-health/accept-risk';
import {
  EvaluatePolicyHealthSchema,
  AcceptHealthRiskSchema,
} from '@/lib/validation/schemas/policy-health';

const requirePermissionMock = vi.mocked(requirePermission);
const getActiveOrgMock = vi.mocked(getActiveOrg);
const getUserMock = vi.mocked(getUser);
const evaluateMock = vi.mocked(evaluatePolicyHealth);
const acceptMock = vi.mocked(acceptHealthRisk);

const VER = '44444444-4444-4444-8444-444444444444';
const EVAL = '55555555-5555-4555-8555-555555555555';

function setRole(role: string) {
  getActiveOrgMock.mockResolvedValue({ organization_id: 'o1', profile_id: 'u1', primary_role: role } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockResolvedValue(undefined);
  setRole('hr');
  getUserMock.mockResolvedValue({ id: 'u1' } as never);
  evaluateMock.mockResolvedValue({ evaluation: { id: EVAL, overallScore: 88 }, created: true } as never);
  acceptMock.mockResolvedValue({ id: 'acc-1' } as never);
});

// ── schemas ──────────────────────────────────────────────────────────────────────
describe('policy-health action schemas', () => {
  it('EvaluatePolicyHealthSchema: uuid required; commandId optional', () => {
    expect(EvaluatePolicyHealthSchema.safeParse({ policyVersionId: VER }).success).toBe(true);
    expect(EvaluatePolicyHealthSchema.safeParse({ policyVersionId: VER, commandId: EVAL }).success).toBe(true);
    expect(EvaluatePolicyHealthSchema.safeParse({ policyVersionId: 'nope' }).success).toBe(false);
  });

  it('AcceptHealthRiskSchema: uuid eval + non-empty dimension/driver/reason; expiry ISO optional', () => {
    const ok = { healthEvaluationId: EVAL, dimension: 'gaming_resistance', driverCode: 'THRESHOLD_CLIFF', reason: 'ok' };
    expect(AcceptHealthRiskSchema.safeParse(ok).success).toBe(true);
    expect(AcceptHealthRiskSchema.safeParse({ ...ok, expiresAt: '2027-01-01T00:00:00.000Z' }).success).toBe(true);
    expect(AcceptHealthRiskSchema.safeParse({ ...ok, reason: '   ' }).success).toBe(false); // trimmed empty
    expect(AcceptHealthRiskSchema.safeParse({ ...ok, driverCode: '' }).success).toBe(false);
    expect(AcceptHealthRiskSchema.safeParse({ ...ok, healthEvaluationId: 'x' }).success).toBe(false);
    expect(AcceptHealthRiskSchema.safeParse({ ...ok, expiresAt: 'not-a-date' }).success).toBe(false);
  });
});

// ── evaluatePolicyHealthAction (admin client injected) ────────────────────────────
describe('evaluatePolicyHealthAction', () => {
  it('happy: enforces policy.manage + delegates ctx and the injected ADMIN client', async () => {
    const res = await evaluatePolicyHealthAction({ policyVersionId: VER });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual({ evaluationId: EVAL, overallScore: 88, created: true });
    expect(requirePermissionMock).toHaveBeenCalledWith('policy.manage');
    expect(evaluateMock).toHaveBeenCalledWith(VER, { organizationId: 'o1', userId: 'u1' }, { admin: true });
    expect(createAdminClient).toHaveBeenCalled();
  });

  it('deny: requirePermission throws → module NOT called (server-side authz, not client)', async () => {
    requirePermissionMock.mockRejectedValue(new Error('FORBIDDEN'));
    const res = await evaluatePolicyHealthAction({ policyVersionId: VER });
    expect(res.ok).toBe(false);
    expect(evaluateMock).not.toHaveBeenCalled();
  });

  it('validation: invalid uuid → ok:false, module NOT called', async () => {
    const res = await evaluatePolicyHealthAction({ policyVersionId: 'bad' } as never);
    expect(res.ok).toBe(false);
    expect(evaluateMock).not.toHaveBeenCalled();
  });
});

// ── acceptHealthRiskAction (RLS user client — audited authenticated insert) ────────
describe('acceptHealthRiskAction', () => {
  const input = { healthEvaluationId: EVAL, dimension: 'gaming_resistance', driverCode: 'THRESHOLD_CLIFF', reason: 'design choice' };

  it('happy: enforces policy.manage + delegates via the RLS USER client (NOT admin)', async () => {
    const res = await acceptHealthRiskAction(input);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual({ acceptanceId: 'acc-1' });
    expect(requirePermissionMock).toHaveBeenCalledWith('policy.manage');
    expect(createClient).toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled(); // audit actor integrity: NOT the service_role client
    expect(acceptMock).toHaveBeenCalledWith(
      { healthEvaluationId: EVAL, dimension: 'gaming_resistance', driverCode: 'THRESHOLD_CLIFF', reason: 'design choice', expiresAt: null },
      { organizationId: 'o1', userId: 'u1' },
      { rls: true },
    );
  });

  it('passes an optional expiry through unchanged', async () => {
    await acceptHealthRiskAction({ ...input, expiresAt: '2027-01-01T00:00:00.000Z' });
    expect(acceptMock).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: '2027-01-01T00:00:00.000Z' }),
      expect.anything(),
      { rls: true },
    );
  });

  it('deny: requirePermission throws → module NOT called', async () => {
    requirePermissionMock.mockRejectedValue(new Error('FORBIDDEN'));
    const res = await acceptHealthRiskAction(input);
    expect(res.ok).toBe(false);
    expect(acceptMock).not.toHaveBeenCalled();
  });

  it('BOUNDARY: employee cannot accept a risk when requirePermission rejects', async () => {
    setRole('employee');
    requirePermissionMock.mockRejectedValue(new Error('FORBIDDEN'));
    const res = await acceptHealthRiskAction(input);
    expect(res.ok).toBe(false);
    expect(acceptMock).not.toHaveBeenCalled();
  });

  it('validation: blank reason → ok:false, module NOT called (no silent dismiss — §3.8)', async () => {
    const res = await acceptHealthRiskAction({ ...input, reason: '   ' });
    expect(res.ok).toBe(false);
    expect(acceptMock).not.toHaveBeenCalled();
  });
});
