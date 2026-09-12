import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── mocks ──────────────────────────────────────────────────────────────────────
vi.mock('@/lib/auth/rbac', () => ({
  requirePermission: vi.fn(),
  PermissionError: class PermissionError extends Error {},
}));
vi.mock('@/lib/auth/org', () => ({ getActiveOrg: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getUser: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({ admin: true })) }));

// The module is mocked: spy the delegated evaluate fn. The app schema is validated separately below
// against the REAL source (not this mock).
vi.mock('@/modules/policy-complexity', () => ({ evaluatePolicyDebt: vi.fn() }));

import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { evaluatePolicyDebt } from '@/modules/policy-complexity';
import { evaluatePolicyDebtAction } from '@/app/actions/policy-debt/evaluate-policy-debt';
import { EvaluatePolicyDebtSchema } from '@/lib/validation/schemas/policy-debt';

const requirePermissionMock = vi.mocked(requirePermission);
const getActiveOrgMock = vi.mocked(getActiveOrg);
const getUserMock = vi.mocked(getUser);
const evaluatePolicyDebtMock = vi.mocked(evaluatePolicyDebt);

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
  evaluatePolicyDebtMock.mockResolvedValue({
    evaluation: { id: EVAL, totalScore: 42 },
    candidates: [{ code: 'c1' }, { code: 'c2' }],
  } as never);
});

// ── schema ─────────────────────────────────────────────────────────────────────
describe('EvaluatePolicyDebtSchema', () => {
  it('accepts a uuid policyVersionId; commandId optional', () => {
    expect(EvaluatePolicyDebtSchema.safeParse({ policyVersionId: VER }).success).toBe(true);
    expect(EvaluatePolicyDebtSchema.safeParse({ policyVersionId: VER, commandId: EVAL }).success).toBe(true);
  });

  it('rejects a non-uuid policyVersionId / missing field', () => {
    expect(EvaluatePolicyDebtSchema.safeParse({ policyVersionId: 'nope' }).success).toBe(false);
    expect(EvaluatePolicyDebtSchema.safeParse({}).success).toBe(false);
    expect(EvaluatePolicyDebtSchema.safeParse({ policyVersionId: VER, commandId: 'x' }).success).toBe(false);
  });
});

// ── evaluatePolicyDebtAction ─────────────────────────────────────────────────────
describe('evaluatePolicyDebtAction', () => {
  it('happy: enforces policy.manage + delegates with ctx and the injected admin client', async () => {
    const res = await evaluatePolicyDebtAction({ policyVersionId: VER });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual({ evaluationId: EVAL, totalScore: 42, candidateCount: 2 });
    }
    expect(requirePermissionMock).toHaveBeenCalledWith('policy.manage');
    expect(evaluatePolicyDebtMock).toHaveBeenCalledWith(
      VER,
      { organizationId: 'o1', userId: 'u1' },
      { admin: true },
    );
  });

  it('deny: requirePermission throws → module NOT called (server-side authz, not client)', async () => {
    requirePermissionMock.mockRejectedValue(new Error('FORBIDDEN'));
    const res = await evaluatePolicyDebtAction({ policyVersionId: VER });
    expect(res.ok).toBe(false);
    expect(evaluatePolicyDebtMock).not.toHaveBeenCalled();
  });

  it('BOUNDARY: employee cannot evaluate when requirePermission rejects', async () => {
    setRole('employee');
    requirePermissionMock.mockRejectedValue(new Error('FORBIDDEN'));
    const res = await evaluatePolicyDebtAction({ policyVersionId: VER });
    expect(res.ok).toBe(false);
    expect(evaluatePolicyDebtMock).not.toHaveBeenCalled();
  });

  it('validation: invalid uuid → ok:false, module NOT called', async () => {
    const res = await evaluatePolicyDebtAction({ policyVersionId: 'not-a-uuid' } as never);
    expect(res.ok).toBe(false);
    expect(evaluatePolicyDebtMock).not.toHaveBeenCalled();
  });
});
