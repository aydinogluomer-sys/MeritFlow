import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// ── mocks ──────────────────────────────────────────────────────────────────────
vi.mock('@/lib/auth/rbac', () => ({
  requirePermission: vi.fn(),
  PermissionError: class PermissionError extends Error {},
}));
vi.mock('@/lib/auth/org', () => ({ getActiveOrg: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getUser: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({ admin: true })) }));

// The module is mocked: spy the delegated functions; provide a REAL zod schema for the create action's
// validatedAction (the app schemas are tested separately against the real source).
vi.mock('@/modules/policy-change-impact', () => ({
  createPolicyChangeRequest: vi.fn(),
  submitPolicyChangeRequest: vi.fn(),
  approvePolicyChangeRequestAsHr: vi.fn(),
  approvePolicyChangeRequestAsFinance: vi.fn(),
  rejectPolicyChangeRequest: vi.fn(),
  requestChangesOnPolicyChangeRequest: vi.fn(),
  generatePolicyChangeImpact: vi.fn(),
  NewChangeRequestInputSchema: z.object({
    scoringPolicyId: z.string().uuid(),
    fromVersionId: z.string().uuid(),
    toDraftVersionId: z.string().uuid(),
    reason: z.string().min(1),
    effectiveDate: z.string().optional(),
    allowRetroactive: z.boolean().optional(),
  }),
}));

import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import {
  createPolicyChangeRequest,
  submitPolicyChangeRequest,
  approvePolicyChangeRequestAsHr,
  approvePolicyChangeRequestAsFinance,
  rejectPolicyChangeRequest,
  requestChangesOnPolicyChangeRequest,
  generatePolicyChangeImpact,
} from '@/modules/policy-change-impact';
import { createChangeRequest } from '@/app/actions/policy-impact/create-change-request';
import { submitChangeRequest } from '@/app/actions/policy-impact/submit-change-request';
import { approveChangeRequest } from '@/app/actions/policy-impact/approve-change-request';
import { decideChangeRequest } from '@/app/actions/policy-impact/decide-change-request';
import { runSimulation } from '@/app/actions/policy-impact/run-simulation';
import {
  ChangeRequestIdSchema,
  DecideChangeRequestSchema,
  RunSimulationSchema,
} from '@/lib/validation/schemas/policy-impact';

const requirePermissionMock = vi.mocked(requirePermission);
const getActiveOrgMock = vi.mocked(getActiveOrg);
const getUserMock = vi.mocked(getUser);

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const CR = '44444444-4444-4444-8444-444444444444';
const PERIOD = '55555555-5555-4555-8555-555555555555';

function setRole(role: string) {
  getActiveOrgMock.mockResolvedValue({ organization_id: 'o1', profile_id: 'u1', primary_role: role } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockResolvedValue(undefined);
  setRole('hr');
  getUserMock.mockResolvedValue({ id: 'u1' } as never);
});

// ── schema tests ─────────────────────────────────────────────────────────────
describe('policy-impact action schemas', () => {
  it('ChangeRequestIdSchema: uuid required; commandId optional', () => {
    expect(ChangeRequestIdSchema.safeParse({ changeRequestId: CR }).success).toBe(true);
    expect(ChangeRequestIdSchema.safeParse({ changeRequestId: CR, commandId: U1 }).success).toBe(true);
    expect(ChangeRequestIdSchema.safeParse({ changeRequestId: 'nope' }).success).toBe(false);
  });

  it('DecideChangeRequestSchema: decision enum + non-empty note', () => {
    expect(
      DecideChangeRequestSchema.safeParse({ changeRequestId: CR, decision: 'reject', note: 'no' }).success,
    ).toBe(true);
    expect(
      DecideChangeRequestSchema.safeParse({ changeRequestId: CR, decision: 'reject', note: '' }).success,
    ).toBe(false);
    expect(
      DecideChangeRequestSchema.safeParse({ changeRequestId: CR, decision: 'nope', note: 'x' }).success,
    ).toBe(false);
  });

  it('RunSimulationSchema: both ids required', () => {
    expect(RunSimulationSchema.safeParse({ changeRequestId: CR, referencePeriodId: PERIOD }).success).toBe(true);
    expect(RunSimulationSchema.safeParse({ changeRequestId: CR }).success).toBe(false);
  });
});

// ── create / submit (policy.manage) ────────────────────────────────────────────
describe('createChangeRequest', () => {
  const input = { scoringPolicyId: U1, fromVersionId: U2, toDraftVersionId: U3, reason: 'why' };

  it('happy: enforces policy.manage + delegates with ctx', async () => {
    vi.mocked(createPolicyChangeRequest).mockResolvedValue({ id: CR } as never);
    const res = await createChangeRequest(input);
    expect(res.ok).toBe(true);
    expect(requirePermissionMock).toHaveBeenCalledWith('policy.manage');
    expect(createPolicyChangeRequest).toHaveBeenCalledWith(
      expect.objectContaining({ scoringPolicyId: U1 }),
      { organizationId: 'o1', userId: 'u1' },
    );
  });

  it('deny: requirePermission throws → module NOT called', async () => {
    requirePermissionMock.mockRejectedValue(new Error('FORBIDDEN'));
    const res = await createChangeRequest(input);
    expect(res.ok).toBe(false);
    expect(createPolicyChangeRequest).not.toHaveBeenCalled();
  });
});

describe('submitChangeRequest', () => {
  it('happy: policy.manage + delegates the id', async () => {
    vi.mocked(submitPolicyChangeRequest).mockResolvedValue({ id: CR } as never);
    const res = await submitChangeRequest({ changeRequestId: CR });
    expect(res.ok).toBe(true);
    expect(requirePermissionMock).toHaveBeenCalledWith('policy.manage');
    expect(submitPolicyChangeRequest).toHaveBeenCalledWith(CR, { organizationId: 'o1', userId: 'u1' });
  });

  it('deny: no policy.manage → module NOT called', async () => {
    requirePermissionMock.mockRejectedValue(new Error('FORBIDDEN'));
    const res = await submitChangeRequest({ changeRequestId: CR });
    expect(res.ok).toBe(false);
    expect(submitPolicyChangeRequest).not.toHaveBeenCalled();
  });
});

// ── approve (dual HR/Finance, role-routed) ─────────────────────────────────────
describe('approveChangeRequest', () => {
  it('HR role → approveAsHr', async () => {
    setRole('hr');
    vi.mocked(approvePolicyChangeRequestAsHr).mockResolvedValue({ id: CR } as never);
    const res = await approveChangeRequest({ changeRequestId: CR });
    expect(res.ok).toBe(true);
    expect(approvePolicyChangeRequestAsHr).toHaveBeenCalledWith(CR, { organizationId: 'o1', userId: 'u1' });
    expect(approvePolicyChangeRequestAsFinance).not.toHaveBeenCalled();
  });

  it('Finance role → approveAsFinance', async () => {
    setRole('finance');
    vi.mocked(approvePolicyChangeRequestAsFinance).mockResolvedValue({ id: CR } as never);
    const res = await approveChangeRequest({ changeRequestId: CR });
    expect(res.ok).toBe(true);
    expect(approvePolicyChangeRequestAsFinance).toHaveBeenCalledWith(CR, { organizationId: 'o1', userId: 'u1' });
  });

  it('BOUNDARY: employee cannot approve (neither slot fn called)', async () => {
    setRole('employee');
    const res = await approveChangeRequest({ changeRequestId: CR });
    expect(res.ok).toBe(false);
    expect(approvePolicyChangeRequestAsHr).not.toHaveBeenCalled();
    expect(approvePolicyChangeRequestAsFinance).not.toHaveBeenCalled();
  });

  it('BOUNDARY: manager cannot approve', async () => {
    setRole('manager');
    const res = await approveChangeRequest({ changeRequestId: CR });
    expect(res.ok).toBe(false);
    expect(approvePolicyChangeRequestAsHr).not.toHaveBeenCalled();
    expect(approvePolicyChangeRequestAsFinance).not.toHaveBeenCalled();
  });
});

// ── decide (reject / request changes, HR/Finance only) ─────────────────────────
describe('decideChangeRequest', () => {
  it('HR + reject → rejectPolicyChangeRequest', async () => {
    setRole('hr');
    vi.mocked(rejectPolicyChangeRequest).mockResolvedValue({ id: CR } as never);
    const res = await decideChangeRequest({ changeRequestId: CR, decision: 'reject', note: 'bad' });
    expect(res.ok).toBe(true);
    expect(rejectPolicyChangeRequest).toHaveBeenCalledWith(CR, 'bad', { organizationId: 'o1', userId: 'u1' });
  });

  it('Finance + request_changes → requestChangesOnPolicyChangeRequest', async () => {
    setRole('finance');
    vi.mocked(requestChangesOnPolicyChangeRequest).mockResolvedValue({ id: CR } as never);
    const res = await decideChangeRequest({ changeRequestId: CR, decision: 'request_changes', note: 'fix' });
    expect(res.ok).toBe(true);
    expect(requestChangesOnPolicyChangeRequest).toHaveBeenCalledWith(CR, 'fix', { organizationId: 'o1', userId: 'u1' });
  });

  it('BOUNDARY: manager cannot decide (neither fn called)', async () => {
    setRole('manager');
    const res = await decideChangeRequest({ changeRequestId: CR, decision: 'reject', note: 'x' });
    expect(res.ok).toBe(false);
    expect(rejectPolicyChangeRequest).not.toHaveBeenCalled();
    expect(requestChangesOnPolicyChangeRequest).not.toHaveBeenCalled();
  });

  it('validation: empty note → ok:false, module NOT called', async () => {
    setRole('hr');
    const res = await decideChangeRequest({ changeRequestId: CR, decision: 'reject', note: '' });
    expect(res.ok).toBe(false);
    expect(rejectPolicyChangeRequest).not.toHaveBeenCalled();
  });
});

// ── run simulation (policy.manage; admin client injected) ──────────────────────
describe('runSimulation', () => {
  it('happy: policy.manage + generatePolicyChangeImpact with the admin client', async () => {
    vi.mocked(generatePolicyChangeImpact).mockResolvedValue({ id: 'imp1' } as never);
    const res = await runSimulation({ changeRequestId: CR, referencePeriodId: PERIOD });
    expect(res.ok).toBe(true);
    expect(requirePermissionMock).toHaveBeenCalledWith('policy.manage');
    expect(generatePolicyChangeImpact).toHaveBeenCalledWith(
      { changeRequestId: CR, referencePeriodId: PERIOD },
      { organizationId: 'o1', userId: 'u1' },
      { admin: true },
    );
  });

  it('deny: no policy.manage → module NOT called', async () => {
    requirePermissionMock.mockRejectedValue(new Error('FORBIDDEN'));
    const res = await runSimulation({ changeRequestId: CR, referencePeriodId: PERIOD });
    expect(res.ok).toBe(false);
    expect(generatePolicyChangeImpact).not.toHaveBeenCalled();
  });
});
