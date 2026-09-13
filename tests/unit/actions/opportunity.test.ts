import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── mocks ──────────────────────────────────────────────────────────────────────
vi.mock('@/lib/auth/rbac', () => ({
  requirePermission: vi.fn(),
  PermissionError: class PermissionError extends Error {},
}));
vi.mock('@/lib/auth/org', () => ({ getActiveOrg: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({ admin: true })) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ rls: true })) }));

const { transitionMock } = vi.hoisted(() => ({ transitionMock: vi.fn() }));
vi.mock('@/modules/intelligence', () => ({
  IntelligenceRepository: class {
    transition = transitionMock;
  },
}));

import { requirePermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { resolveOpportunityFlagAction } from '@/app/actions/opportunity/resolve-flag';
import { ResolveOpportunityFlagSchema } from '@/lib/validation/schemas/opportunity';

const requirePermissionMock = vi.mocked(requirePermission);
const getActiveOrgMock = vi.mocked(getActiveOrg);

const INSIGHT = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockResolvedValue(undefined);
  getActiveOrgMock.mockResolvedValue({ organization_id: 'o1', profile_id: 'u1', primary_role: 'manager' } as never);
  transitionMock.mockResolvedValue({ id: INSIGHT, status: 'dismissed' });
});

// ── schema ──────────────────────────────────────────────────────────────────────
describe('ResolveOpportunityFlagSchema', () => {
  it('accepts a review step without a reason', () => {
    expect(ResolveOpportunityFlagSchema.safeParse({ insightId: INSIGHT, toStatus: 'reviewed' }).success).toBe(true);
  });
  it('REQUIRES a reason for a resolution outcome (accepted/dismissed)', () => {
    expect(ResolveOpportunityFlagSchema.safeParse({ insightId: INSIGHT, toStatus: 'dismissed' }).success).toBe(false);
    expect(ResolveOpportunityFlagSchema.safeParse({ insightId: INSIGHT, toStatus: 'accepted' }).success).toBe(false);
    expect(ResolveOpportunityFlagSchema.safeParse({ insightId: INSIGHT, toStatus: 'dismissed', resolutionCode: 'no action' }).success).toBe(true);
  });
  it('rejects a bad uuid or an out-of-lifecycle status', () => {
    expect(ResolveOpportunityFlagSchema.safeParse({ insightId: 'nope', toStatus: 'reviewed' }).success).toBe(false);
    expect(ResolveOpportunityFlagSchema.safeParse({ insightId: INSIGHT, toStatus: 'draft' }).success).toBe(false);
  });
});

// ── resolveOpportunityFlagAction ─────────────────────────────────────────────────
describe('resolveOpportunityFlagAction', () => {
  it('happy: floor gate intelligence.read + transitions via the RLS USER client (NOT admin)', async () => {
    const res = await resolveOpportunityFlagAction({ insightId: INSIGHT, toStatus: 'dismissed', resolutionCode: 'no action' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual({ id: INSIGHT, status: 'dismissed' });
    expect(requirePermissionMock).toHaveBeenCalledWith('intelligence.read');
    expect(createClient).toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled(); // audit-actor integrity: NOT the service_role client
    expect(transitionMock).toHaveBeenCalledWith(INSIGHT, 'o1', 'dismissed', 'no action');
  });

  it('deny: requirePermission throws → transition NOT called (server-side authz, not client)', async () => {
    requirePermissionMock.mockRejectedValue(new Error('FORBIDDEN'));
    const res = await resolveOpportunityFlagAction({ insightId: INSIGHT, toStatus: 'dismissed', resolutionCode: 'x' });
    expect(res.ok).toBe(false);
    expect(transitionMock).not.toHaveBeenCalled();
  });

  it('validation: resolution outcome without a reason → ok:false, transition NOT called', async () => {
    const res = await resolveOpportunityFlagAction({ insightId: INSIGHT, toStatus: 'dismissed' } as never);
    expect(res.ok).toBe(false);
    expect(transitionMock).not.toHaveBeenCalled();
  });

  it('validation: bad uuid → ok:false, transition NOT called', async () => {
    const res = await resolveOpportunityFlagAction({ insightId: 'bad', toStatus: 'reviewed' } as never);
    expect(res.ok).toBe(false);
    expect(transitionMock).not.toHaveBeenCalled();
  });
});
